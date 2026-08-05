// Preview step of an Upload. Stages the file, validates its shape and reports
// what confirming it would do — without writing a single row to the mirror.
// Both admin and viewer may Upload (docs/adr/0004); provenance, not permission,
// is the safeguard, and the row that records it is written by /api/sync.

import { NextResponse, type NextRequest } from 'next/server';
import { inArray } from 'drizzle-orm';
import { db } from '@shared/db/client';
import { basketPriceTiers, basketUsers } from '@basket/infrastructure/db/schema';
import { platformName } from '@basket/core/value-objects/Platform';
import { classifyNotApproved } from '@basket/core/value-objects/PaymentStatus';
import {
  PAYMENT_UPLOAD_COLUMNS,
  type PaymentUploadRow,
  type UploadPreviewDTO,
  type UploadRejection,
  type UploadWarning,
} from '@basket/core/dtos/PaymentUploadDTO';
import { getSessionUser } from '@/lib/auth/getSessionUser';

// Mirrors the bypass in src/proxy.ts: honoured only outside production and only
// when INTERNAL_API_TOKEN is set. Used by scripts/smoke-payments-upload.ts.
function internalBypass(req: NextRequest): boolean {
  const token = process.env.INTERNAL_API_TOKEN;
  return (
    process.env.NODE_ENV !== 'production' &&
    !!token &&
    req.headers.get('x-internal-token') === token
  );
}
import { streamCsvFile } from '@shared/lib/csvStream';
import {
  MAX_UPLOAD_BYTES,
  UploadTooLargeError,
  deleteStagedFile,
  readStagedHead,
  rememberUploadMeta,
  sniffBinary,
  stageUpload,
  sweepStagedFiles,
} from '@shared/lib/uploadStaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Windows shorter than this leave gaps between consecutive Uploads. */
const MIN_WINDOW_DAYS = 30;

/** Period, in days, of a monthly Pago — the only one Tiers resolve. */
const MONTHLY_RECURRENT = 30;

/** How many distinct Subscriber ids to ask about per statement. */
const ID_QUERY_CHUNK = 20_000;

function reject(error: UploadRejection['error'], message: string): NextResponse {
  const body: UploadRejection = { error, message };
  return NextResponse.json(body, { status: 400 });
}

/** `dd/mm/yyyy HH:MM` as emitted by the Control Panel — not ISO. */
const CREATED_RX = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})/;

function parseCreated(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = CREATED_RX.exec(raw.trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi] = m;
  const ms = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
  return Number.isFinite(ms) ? ms : null;
}

function parseHeader(head: Buffer): string[] | null {
  const text = head.toString('utf8').replace(/^﻿/, '');
  const nl = text.search(/\r?\n/);
  const line = nl === -1 ? text : text.slice(0, nl);
  if (!line.trim()) return null;
  return line.split(',').map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase());
}

/**
 * Distinct Subscriber ids resolved in one set-based statement (chunked only if
 * the Export names more ids than one statement should carry). Returns null when
 * `basket_users` cannot be read at all, so the caller can stay silent rather
 * than claim every Pago would be skipped.
 */
async function findKnownSubscriberIds(ids: number[]): Promise<Set<number> | null> {
  if (ids.length === 0) return new Set();
  try {
    const known = new Set<number>();
    for (let i = 0; i < ids.length; i += ID_QUERY_CHUNK) {
      const rows = await db
        .select({ id: basketUsers.id })
        .from(basketUsers)
        .where(inArray(basketUsers.id, ids.slice(i, i + ID_QUERY_CHUNK)));
      for (const row of rows) known.add(row.id);
    }
    return known;
  } catch {
    return null;
  }
}

/**
 * Currencies with at least one monthly Tier. Returns null when the Tier table is
 * absent — the migration that creates it may not have been applied yet, and a
 * missing table is not an Upload problem.
 */
async function findTierCurrencies(): Promise<Set<string> | null> {
  try {
    const rows = await db
      .select({ currency: basketPriceTiers.currency, recurrent: basketPriceTiers.recurrent })
      .from(basketPriceTiers);
    return new Set(
      rows
        .filter((r) => Number(r.recurrent) === MONTHLY_RECURRENT)
        .map((r) => r.currency.trim().toLowerCase()),
    );
  } catch {
    return null;
  }
}

interface Tally {
  rowTotal: number;
  minMs: number | null;
  maxMs: number | null;
  byProvider: Record<string, number>;
  approved: number;
  failed: number;
  rejected: number;
  pending: number;
  otherNotApproved: number;
  /** Rows per distinct Subscriber id — ints, never rows. */
  rowsByUserId: Map<number, number>;
  /** Rows whose `user_id` is missing or not a number; the mapper drops these. */
  rowsWithoutUserId: number;
  /** Monthly rows per currency, for the Tier check. */
  monthlyRowsByCurrency: Map<string, number>;
}

/** One pass over the staged file. Nothing but counters is retained. */
async function tally(filePath: string): Promise<Tally> {
  const acc: Tally = {
    rowTotal: 0,
    minMs: null,
    maxMs: null,
    byProvider: {},
    approved: 0,
    failed: 0,
    rejected: 0,
    pending: 0,
    otherNotApproved: 0,
    rowsByUserId: new Map(),
    rowsWithoutUserId: 0,
    monthlyRowsByCurrency: new Map(),
  };

  for await (const row of streamCsvFile<PaymentUploadRow>(filePath, { delimiter: ',', bom: true })) {
    acc.rowTotal += 1;

    const ms = parseCreated(row.created);
    if (ms !== null) {
      if (acc.minMs === null || ms < acc.minMs) acc.minMs = ms;
      if (acc.maxMs === null || ms > acc.maxMs) acc.maxMs = ms;
    }

    const provider = platformName(Number(row.platform));
    acc.byProvider[provider] = (acc.byProvider[provider] ?? 0) + 1;

    const status = row.status?.trim();
    if (status === '1') acc.approved += 1;
    else if (status === '0') {
      acc.failed += 1;
      const kind = classifyNotApproved(row.status_detail);
      if (kind === 'rejected') acc.rejected += 1;
      else if (kind === 'pending') acc.pending += 1;
      else acc.otherNotApproved += 1;
    }

    const userId = Number(row.user_id);
    if (Number.isInteger(userId) && userId > 0) {
      acc.rowsByUserId.set(userId, (acc.rowsByUserId.get(userId) ?? 0) + 1);
    } else {
      acc.rowsWithoutUserId += 1;
    }

    if (Number(row.recurrent) === MONTHLY_RECURRENT) {
      const currency = (row.currency ?? '').trim().toLowerCase();
      if (currency) {
        acc.monthlyRowsByCurrency.set(currency, (acc.monthlyRowsByCurrency.get(currency) ?? 0) + 1);
      }
    }
  }

  return acc;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Authentication only: ADR 0004 deliberately lets viewers Upload too.
  // Must NOT use requireSession() — that redirects, which turns an unauthorised
  // API call into a 303 to /login and then a 404 HTML page. API routes answer
  // 401 JSON. The proxy's internal-token bypass is honoured the same way
  // /api/sync does it, so smoke scripts can drive this endpoint.
  const user = await getSessionUser();
  if (!user && !internalBypass(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  void sweepStagedFiles().catch(() => {});

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) {
    return NextResponse.json(
      { error: 'no_file', message: 'No se recibió ningún archivo en el campo "file".' },
      { status: 400 },
    );
  }

  let staged;
  try {
    staged = await stageUpload(file.stream() as ReadableStream<Uint8Array>);
  } catch (err) {
    if (err instanceof UploadTooLargeError) {
      const mb = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));
      return reject(
        'too_large',
        `El archivo supera el máximo de ${mb} MB. Descargá el Export de un período más corto.`,
      );
    }
    throw err;
  }

  // The staged file only survives this request when a preview was produced and
  // its id handed to the browser; every rejection and every crash drops it.
  let confirmed = false;
  try {
    const head = await readStagedHead(staged.path);

    const binary = sniffBinary(head);
    if (binary === 'xlsx' || binary === 'xls') {
      return reject(
        'not_csv',
        'El archivo es un libro de Excel, no un CSV (aunque la extensión diga .csv). ' +
          'En el Panel de Control elegí descargar el Export en formato CSV y volvé a subirlo.',
      );
    }
    if (binary === 'binary') {
      return reject(
        'not_csv',
        'El contenido del archivo no es texto CSV. Descargá el Export en formato CSV y volvé a subirlo.',
      );
    }

    const header = parseHeader(head);
    const expected = PAYMENT_UPLOAD_COLUMNS.map((c) => c.toLowerCase());
    if (!header || header.length !== expected.length || header.some((c, i) => c !== expected[i])) {
      return reject(
        'bad_header',
        'Las columnas del archivo no coinciden con el Export de Pagos. ' +
          `Se esperaban, en este orden: ${PAYMENT_UPLOAD_COLUMNS.join(', ')}.`,
      );
    }

    const acc = await tally(staged.path);
    if (acc.rowTotal === 0) {
      return reject('empty', 'El archivo no tiene filas de datos, solo el encabezado.');
    }

    const windowFrom = acc.minMs === null ? null : new Date(acc.minMs).toISOString();
    const windowTo = acc.maxMs === null ? null : new Date(acc.maxMs).toISOString();
    const windowDays =
      acc.minMs === null || acc.maxMs === null
        ? null
        : Math.max(1, Math.round((acc.maxMs - acc.minMs) / 86_400_000));

    const ids = [...acc.rowsByUserId.keys()];
    const known = await findKnownSubscriberIds(ids);
    let wouldSkip = acc.rowsWithoutUserId;
    if (known) {
      for (const [id, rows] of acc.rowsByUserId) {
        if (!known.has(id)) wouldSkip += rows;
      }
    }

    const warnings: UploadWarning[] = [];

    if (windowDays !== null && windowDays < MIN_WINDOW_DAYS) {
      warnings.push({
        code: 'short_window',
        message:
          `El archivo cubre ${windowDays} día(s). Un Export de menos de ${MIN_WINDOW_DAYS} días ` +
          'puede dejar huecos entre esta carga y la anterior.',
        count: windowDays,
      });
    }

    // The Pagos Export and the Suscripciones Export share the same 15 columns,
    // so the absence of failures is the only signal that the wrong one was picked.
    if (acc.failed === 0) {
      warnings.push({
        code: 'looks_like_subscriptions',
        message:
          'No hay ningún Pago fallido en el archivo. El Export de Pagos siempre incluye ' +
          'intentos fallidos, así que es probable que hayas subido el Export de Suscripciones.',
      });
    }

    if (wouldSkip > 0) {
      warnings.push({
        code: 'unknown_subscribers',
        message:
          `${wouldSkip} Pagos pertenecen a Suscriptores que el espejo todavía no conoce y se ` +
          'omitirían. La sincronización refresca los Suscriptores primero, así que el número final ' +
          'puede ser menor.',
        count: wouldSkip,
      });
    }

    const tierCurrencies = await findTierCurrencies();
    if (tierCurrencies) {
      let unmappedRows = 0;
      const unmappedCurrencies: string[] = [];
      for (const [currency, rows] of acc.monthlyRowsByCurrency) {
        if (!tierCurrencies.has(currency)) {
          unmappedRows += rows;
          unmappedCurrencies.push(currency.toUpperCase());
        }
      }
      if (unmappedRows > 0) {
        warnings.push({
          code: 'unmapped_price_points',
          message:
            `${unmappedRows} Pagos mensuales usan monedas sin Tier configurado ` +
            `(${unmappedCurrencies.join(', ')}); su tipo de suscripción quedará como "Otros".`,
          count: unmappedRows,
        });
      }
    }

    const preview: UploadPreviewDTO = {
      uploadId: staged.uploadId,
      filename: file.name || 'export.csv',
      byteSize: staged.byteSize,
      rowTotal: acc.rowTotal,
      windowFrom,
      windowTo,
      windowDays,
      byProvider: acc.byProvider,
      approved: acc.approved,
      failed: acc.failed,
      rejected: acc.rejected,
      pending: acc.pending,
      otherNotApproved: acc.otherNotApproved,
      wouldSkip,
      warnings,
    };
    confirmed = true;
    rememberUploadMeta(preview.uploadId, {
      filename: preview.filename,
      byteSize: preview.byteSize,
      rowTotal: preview.rowTotal,
      windowFrom: preview.windowFrom,
      windowTo: preview.windowTo,
    });
    return NextResponse.json(preview);
  } finally {
    if (!confirmed) await deleteStagedFile(staged.path);
  }
}
