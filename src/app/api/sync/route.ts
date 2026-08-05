import { existsSync, statSync } from 'node:fs';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { composeRunSync } from '@basket/infrastructure/sync/composeRunSync';
import type { RunSyncResult } from '@basket/core/use-cases/sync/RunSyncUseCase';
import type { UploadResultDTO } from '@basket/core/dtos/PaymentUploadDTO';
import { DrizzleSyncStateRepository } from '@basket/infrastructure/db/repositories/DrizzleSyncStateRepository';
import { DrizzlePaymentUploadRepository } from '@basket/infrastructure/db/repositories/DrizzlePaymentUploadRepository';
import { composeSyncPartidos } from '@partidos/infrastructure/sync/composeSyncPartidos';
import { DrizzlePartidosSyncStateRepository } from '@partidos/infrastructure/db/repositories/DrizzlePartidosSyncStateRepository';
import { getSessionUser } from '@/lib/auth/getSessionUser';
import { deleteStagedFile, resolveStagedPath, takeUploadMeta } from '@shared/lib/uploadStaging';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let basketInFlight: Promise<unknown> | null = null;
let partidosInFlight: Promise<unknown> | null = null;
let startedAt: number | null = null;
let lastError: string | null = null;
let lastResult: { basket?: unknown; partidos?: unknown; upload?: UploadResultDTO } = {};

const SyncBodySchema = z.object({
  /** Handle returned by /api/basket/payments/upload. */
  uploadId: z.string().uuid(),
  filename: z.string().min(1).max(400).optional(),
  rowTotal: z.number().int().nonnegative().optional(),
  windowFrom: z.string().datetime().nullish(),
  windowTo: z.string().datetime().nullish(),
});

function tokenMatches(req: NextRequest): boolean {
  const expected = process.env.SYNC_TOKEN;
  return Boolean(expected) && req.headers.get('x-sync-token') === expected;
}

// Mirrors the bypass in src/proxy.ts: honoured only outside production and only
// when INTERNAL_API_TOKEN is set. Used by scripts/smoke-payments-upload.ts, and
// deliberately NOT a second production credential.
function internalBypass(req: NextRequest): boolean {
  const token = process.env.INTERNAL_API_TOKEN;
  return (
    process.env.NODE_ENV !== 'production' &&
    !!token &&
    req.headers.get('x-internal-token') === token
  );
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface UploadProvenance {
  filename: string;
  byteSize: number;
  rowTotal: number;
  windowFrom: string | null;
  windowTo: string | null;
}

/**
 * Provenance for the Upload this run consumed: who, what file, how much of it
 * landed. Never allowed to fail the run — the mirror is already written by the
 * time we get here, and the table may predate its migration.
 */
async function recordUpload(
  uploads: DrizzlePaymentUploadRepository,
  provenance: UploadProvenance,
  email: string | null,
  result: RunSyncResult | null,
  error: string | null,
): Promise<void> {
  try {
    await uploads.record({
      uploadedBy: email ?? 'automation:x-sync-token',
      filename: provenance.filename,
      byteSize: provenance.byteSize,
      rowTotal: provenance.rowTotal,
      rowsIngested: result?.syncedPayments ?? 0,
      rowsSkipped: result?.skippedPayments ?? 0,
      windowFrom: toDate(provenance.windowFrom),
      windowTo: toDate(provenance.windowTo),
      error,
    });
  } catch (err) {
    console.error('payment upload provenance not recorded:', (err as Error).message);
  }
}

export async function GET(): Promise<NextResponse> {
  const basketRepo = new DrizzleSyncStateRepository();
  const partidosRepo = new DrizzlePartidosSyncStateRepository();
  const [basketSources, partidos] = await Promise.all([
    basketRepo.findAll(),
    partidosRepo.get(),
  ]);

  const sources = [
    ...basketSources.map((r) => ({
      source: r.source,
      lastSync: r.lastSync.toISOString(),
      rowCount: r.rowCount,
    })),
  ];
  if (partidos.lastSyncAt) {
    sources.push({
      source: 'partidos:nacional',
      lastSync: partidos.lastSyncAt.toISOString(),
      rowCount: partidos.lastCountNacional,
    });
    sources.push({
      source: 'partidos:intl',
      lastSync: partidos.lastSyncAt.toISOString(),
      rowCount: partidos.lastCountIntl,
    });
  }

  return NextResponse.json({
    sources,
    inFlight: basketInFlight !== null || partidosInFlight !== null,
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    lastError: lastError ?? partidos.lastError ?? null,
    lastResult,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Either an allowlisted Analyst (admin or viewer, per docs/adr/0004) or the
  // automation token. The token path stays so schedulers keep working.
  const byToken = tokenMatches(req) || internalBypass(req);
  const user = byToken ? null : await getSessionUser();
  if (!byToken && !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = SyncBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'upload_required',
        message:
          'La sincronización necesita un Export de Cobros cargado previamente. ' +
          'Subí el archivo desde el modal de Sync y volvé a intentar.',
      },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const paymentsCsvPath = resolveStagedPath(body.uploadId);
  if (!paymentsCsvPath || !existsSync(paymentsCsvPath)) {
    return NextResponse.json(
      {
        error: 'unknown_upload',
        message: 'El archivo cargado ya no está disponible. Volvé a subirlo.',
      },
      { status: 400 },
    );
  }

  if (basketInFlight || partidosInFlight) {
    return NextResponse.json(
      {
        status: 'already_running',
        startedAt: startedAt ? new Date(startedAt).toISOString() : null,
      },
      { status: 202 },
    );
  }

  startedAt = Date.now();
  lastError = null;
  lastResult = {};

  // Prefer what the preview measured over what the browser reports; the request
  // body is only a fallback for a server that restarted in between.
  const measured = takeUploadMeta(body.uploadId);
  const provenance: UploadProvenance = {
    filename: measured?.filename ?? body.filename ?? 'export.csv',
    byteSize: measured?.byteSize ?? statSync(paymentsCsvPath, { throwIfNoEntry: false })?.size ?? 0,
    rowTotal: measured?.rowTotal ?? body.rowTotal ?? 0,
    windowFrom: measured?.windowFrom ?? body.windowFrom ?? null,
    windowTo: measured?.windowTo ?? body.windowTo ?? null,
  };
  const uploads = new DrizzlePaymentUploadRepository();

  const basketUseCase = await composeRunSync({ paymentsCsvPath });
  const partidosUseCase = composeSyncPartidos();

  const basketP = basketUseCase
    .execute()
    .then(async (r) => {
      lastResult = {
        ...lastResult,
        basket: r,
        upload: {
          uploadId: body.uploadId,
          rowTotal: provenance.rowTotal,
          rowsIngested: r.syncedPayments,
          rowsSkipped: r.skippedPayments,
        },
      };
      await recordUpload(uploads, provenance, user?.email ?? null, r, null);
    })
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      lastError = `basket: ${message}`;
      await recordUpload(uploads, provenance, user?.email ?? null, null, message);
    })
    .finally(async () => {
      basketInFlight = null;
      // The Upload has been consumed either way; the handle is single-use.
      await deleteStagedFile(paymentsCsvPath);
    });
  basketInFlight = basketP;

  const partidosP = partidosUseCase
    .execute()
    .then((r) => {
      lastResult = { ...lastResult, partidos: r };
    })
    .catch((err) => {
      const msg = `partidos: ${err instanceof Error ? err.message : String(err)}`;
      lastError = lastError ? `${lastError} | ${msg}` : msg;
    })
    .finally(() => {
      partidosInFlight = null;
    });
  partidosInFlight = partidosP;

  return NextResponse.json(
    { status: 'started', startedAt: new Date(startedAt).toISOString() },
    { status: 202 },
  );
}
