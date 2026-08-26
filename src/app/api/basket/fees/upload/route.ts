// Preview step of a fee Export Upload — the Provider's own report of what it
// charged us, not our Control Panel's Pagos Export. Stages the file, reads it
// end to end, and reports what confirming would write without writing a row.
//
// The Pagos preview next door refuses anything that is not text CSV. This one
// must accept a workbook: MercadoPago's panel hands the Cobros Export back as
// .xlsx, which is precisely why the Upload screen could not take it before.
//
// Both admin and viewer may Upload (docs/adr/0004); provenance, not permission,
// is the safeguard, and the row that records it is written by the ingest step.

import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@shared/db/client';
import { platformName } from '@basket/core/value-objects/Platform';
import {
  feeExportSource,
  type FeeUploadPreviewDTO,
  type FeeUploadRejection,
  type FeeUploadRejectionCode,
  type FeeUploadWarning,
} from '@basket/core/dtos/FeeUploadDTO';
import { checkFeeTotals, pct, round2 } from '@basket/core/dtos/feeTotalsCheck';
import {
  createExportSource,
  readExportHeader,
} from '@basket/infrastructure/exports/resolveExportSource';
import { getSessionUser } from '@/lib/auth/getSessionUser';
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

/**
 * How many distinct ids the preview will hold to answer "does a Pago exist for
 * this?". A monthly Cobros Export is ~10k rows; this is two years of them, and
 * past it the question is answered as unknown rather than by growing a Set until
 * the 1 GB box swaps.
 */
const ID_SAMPLE_CEILING = 250_000;

function reject(error: FeeUploadRejectionCode, message: string): NextResponse {
  const body: FeeUploadRejection = { error, message };
  return NextResponse.json(body, { status: 400 });
}

function internalBypass(req: NextRequest): boolean {
  const token = process.env.INTERNAL_API_TOKEN;
  return (
    process.env.NODE_ENV !== 'production' &&
    !!token &&
    req.headers.get('x-internal-token') === token
  );
}

/**
 * Which of these ids already exist, on either side of the join.
 *
 * The id list goes down as ONE jsonb parameter rather than as an `IN (…)` of ten
 * thousand binds: a monthly Cobros Export is ~10k operations, and expanding that
 * into placeholders costs a statement Postgres has to parse from scratch every
 * time. `jsonb_array_elements_text` joins against the same partial index the fee
 * mirror already relies on.
 *
 * Advisory, so a failure answers `null` — "not asked" — and the caller stays
 * quiet instead of claiming nothing matches.
 */
async function existingIds(
  ids: string[],
  where: 'payments' | 'fees',
  platform: number,
): Promise<Set<string> | null> {
  if (ids.length === 0) return new Set();
  const table = where === 'payments' ? 'basket_payments' : 'basket_payment_fees';
  try {
    const rows = await db.execute<{ id: string }>(sql`
      SELECT t.platform_payment_id AS id
      FROM ${sql.raw(table)} t
      JOIN jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) AS wanted(id)
        ON wanted.id = t.platform_payment_id
      WHERE t.platform = ${platform}
    `);
    return new Set((rows as unknown as { id: string }[]).map((r) => r.id));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user && !internalBypass(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  void sweepStagedFiles().catch(() => {});

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const sourceId = String(form?.get('source') ?? '');
  const spec = feeExportSource(sourceId);
  if (!spec) {
    return reject('unknown_source', `No conozco el Export "${sourceId}".`);
  }
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
        `El archivo supera el máximo de ${mb} MB. Pedile al panel un Window más corto: ofrece uno.`,
      );
    }
    throw err;
  }

  let keep = false;
  try {
    // The format is decided by the bytes, never by the name: the staged file has
    // no extension at all, and a .csv that is really a workbook is the single
    // most common way this Upload goes wrong.
    const head = await readStagedHead(staged.path);
    const signature = sniffBinary(head);
    if (signature === 'xls') {
      return reject(
        'bad_format',
        'Es un libro de Excel viejo (.xls). Volvé a exportarlo desde el panel: ' +
          'MercadoPago entrega .xlsx, y también acepta CSV.',
      );
    }
    if (signature === 'binary') {
      return reject('bad_format', 'El archivo no es ni un .xlsx ni un CSV de texto.');
    }
    const format: 'csv' | 'xlsx' = signature === 'xlsx' ? 'xlsx' : 'csv';

    const header = await readExportHeader(staged.path, format);
    const missing = spec.requiredColumns.filter((c) => !header.includes(c));
    if (missing.length > 0) {
      return reject(
        'bad_header',
        `Al archivo le faltan columnas del Export de ${spec.label}: ${missing.join(', ')}. ` +
          'Sólo se mira el nombre entre paréntesis del encabezado, que no cambia con el idioma ' +
          'del panel — así que esto suele significar que es otro Export.',
      );
    }

    // Which Export this is was answered by the person, in the picker; the reader
    // comes from the registry so the screen and the SFTP inbox cannot drift into
    // reading the same file two different ways.
    const source = createExportSource(spec.id, staged.path, format, file.name || 'export');
    if (!source) {
      return reject('unknown_source', `No tengo lector para el Export "${spec.id}".`);
    }

    const tally = {
      rows: 0, gross: 0, fee: 0, tax: 0, net: 0, refunded: 0, withTax: 0,
      minMs: Infinity, maxMs: -Infinity, duplicates: 0,
    };
    const byStatus: Record<string, number> = {};
    const ids = new Set<string>();
    let idsTruncated = false;
    let currency = '';

    for await (const row of source.stream()) {
      tally.rows += 1;
      tally.gross += row.grossAmount;
      tally.fee += row.feeAmount;
      tally.net += row.netAmount;
      tally.refunded += row.refundedAmount;
      if (row.taxAmount != null) {
        tally.withTax += 1;
        tally.tax += row.taxAmount;
      }
      if (row.capturedAt) {
        const ms = row.capturedAt.getTime();
        if (ms < tally.minMs) tally.minMs = ms;
        if (ms > tally.maxMs) tally.maxMs = ms;
      }
      currency ||= row.currency;
      const status = row.status ?? 'sin estado';
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (ids.size >= ID_SAMPLE_CEILING) idsTruncated = true;
      else if (ids.has(row.platformPaymentId)) tally.duplicates += 1;
      else ids.add(row.platformPaymentId);
    }

    if (tally.rows === 0) {
      return reject(
        'empty',
        'El archivo tiene el encabezado correcto pero ninguna fila con id de operación.',
      );
    }

    // The assertion the CLI makes per file, and the ratios the invariant cannot
    // make, both in one place now: the SFTP inbox the cron walks has no human
    // looking at a preview and needs exactly these two checks. See
    // core/dtos/feeTotalsCheck.ts.
    const bad = checkFeeTotals(spec, {
      gross: tally.gross, fee: tally.fee, tax: tally.tax, net: tally.net, refunded: tally.refunded,
    });
    if (bad) return reject(bad.error, bad.message);

    const feeShare = pct(tally.fee, tally.gross);

    const idList = [...ids];
    const [inPayments, inFees] = await Promise.all([
      existingIds(idList, 'payments', spec.platform),
      existingIds(idList, 'fees', spec.platform),
    ]);

    const warnings: FeeUploadWarning[] = [];
    const unmatched = inPayments ? idList.length - inPayments.size : 0;
    if (inPayments && unmatched > 0) {
      warnings.push({
        code: 'unmatched_payments',
        count: unmatched,
        message:
          `${unmatched.toLocaleString('es-AR')} operaciones del archivo no tienen Pago en el espejo. ` +
          'La comisión se guarda igual, con el id del Provider como clave, y se une sola si el Pago llega después.',
      });
    }
    if (inFees && inFees.size > 0) {
      warnings.push({
        code: 'already_ingested',
        count: inFees.size,
        message:
          `${inFees.size.toLocaleString('es-AR')} operaciones ya tienen comisión cargada. ` +
          'Se sobrescriben con lo que diga este archivo: es un espejo, no un agregado.',
      });
    }
    if (tally.duplicates > 0) {
      warnings.push({
        code: 'duplicate_ids',
        count: tally.duplicates,
        message: `${tally.duplicates.toLocaleString('es-AR')} ids repetidos dentro del mismo archivo; queda la última fila de cada uno.`,
      });
    }
    if (feeShare < spec.feePctRange[0] || feeShare > spec.feePctRange[1]) {
      warnings.push({
        code: 'unexpected_fee_pct',
        message:
          `La comisión da ${feeShare}% del bruto, fuera del ${spec.feePctRange[0]}–${spec.feePctRange[1]}% ` +
          `que cobra ${spec.platform === 0 ? 'MercadoPago' : spec.label}. Mirá que sea el Export y el mes que esperabas.`,
      });
    }
    if (tally.withTax === 0) {
      warnings.push({
        code: 'no_withholding',
        message:
          'Ninguna fila declara retención. En MercadoPago la retención es la diferencia entre bruto y neto, ' +
          'así que un cero acá suele significar que el archivo no es el de Cobros.',
      });
    }
    const spanDays = Number.isFinite(tally.minMs) && tally.maxMs > 0
      ? Math.round((tally.maxMs - tally.minMs) / 86_400_000)
      : 0;
    if (spanDays > 45) {
      warnings.push({
        code: 'wide_window',
        count: spanDays,
        message:
          `El archivo cubre ${spanDays} días. Los Cobros llegan de a un mes por archivo; ` +
          'uno más ancho no está mal, pero conviene mirar que sea el Export que esperabas.',
      });
    }
    if (idsTruncated) {
      warnings.push({
        code: 'unmatched_payments',
        message:
          'El archivo trae más operaciones de las que el preview compara contra el espejo, ' +
          'así que los cruces de abajo son parciales. La carga en sí no tiene ese límite.',
      });
    }

    const preview: FeeUploadPreviewDTO = {
      uploadId: staged.uploadId,
      source: spec.id,
      sourceLabel: spec.label,
      platformName: platformName(spec.platform),
      filename: file.name || 'export',
      byteSize: staged.byteSize,
      rows: tally.rows,
      skipped: 0,
      currency: currency || 'ARS',
      grossTotal: round2(tally.gross),
      feeTotal: round2(tally.fee),
      taxTotal: round2(tally.tax),
      netTotal: round2(tally.net),
      feePct: pct(tally.fee, tally.gross),
      taxPct: pct(tally.tax, tally.gross),
      rowsWithTax: tally.withTax,
      windowFrom: Number.isFinite(tally.minMs) ? new Date(tally.minMs).toISOString() : null,
      windowTo: tally.maxMs > 0 ? new Date(tally.maxMs).toISOString() : null,
      matchedPagos: inPayments ? inPayments.size : 0,
      alreadyIngested: inFees ? inFees.size : 0,
      byStatus,
      warnings,
    };

    keep = true;
    rememberUploadMeta(preview.uploadId, {
      filename: preview.filename,
      byteSize: preview.byteSize,
      rowTotal: preview.rows,
      windowFrom: preview.windowFrom,
      windowTo: preview.windowTo,
    });
    return NextResponse.json(preview);
  } finally {
    // Every rejection and every crash drops the staged file; only a preview that
    // handed its id to the browser keeps one.
    if (!keep) await deleteStagedFile(staged.path);
  }
}
