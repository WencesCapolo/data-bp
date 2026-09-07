import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { RunSyncResult } from '@basket/core/use-cases/sync/RunSyncUseCase';
import type { UploadResultDTO } from '@basket/core/dtos/PaymentUploadDTO';
import { DrizzleSyncStateRepository } from '@basket/infrastructure/db/repositories/DrizzleSyncStateRepository';
import { pagosUploadIntake } from '@basket/infrastructure/upload/PagosUploadIntake';
import { composeSyncPartidos } from '@partidos/infrastructure/sync/composeSyncPartidos';
import { DrizzlePartidosSyncStateRepository } from '@partidos/infrastructure/db/repositories/DrizzlePartidosSyncStateRepository';
import { getSessionUser } from '@/lib/auth/getSessionUser';
import { internalBypass } from '@/lib/api/uploadRequest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let partidosInFlight: Promise<unknown> | null = null;
let startedAt: number | null = null;
let lastError: string | null = null;
let lastResult: { basket?: RunSyncResult; partidos?: unknown; upload?: UploadResultDTO } = {};

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
    inFlight: pagosUploadIntake().running || partidosInFlight !== null,
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
          'La sincronización necesita un Export de Pagos cargado previamente. ' +
          'Subí el archivo desde el modal de Sync y volvé a intentar.',
      },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const intake = pagosUploadIntake();

  if (intake.running || partidosInFlight) {
    return NextResponse.json(
      {
        status: 'already_running',
        startedAt: startedAt ? new Date(startedAt).toISOString() : null,
      },
      { status: 202 },
    );
  }

  // Pagos only: every other source is the cron's job, and an Analyst should
  // not wait on Stripe to see an Upload land.
  const start = await intake.confirm({
    uploadId: body.uploadId,
    actor: user?.email ?? 'automation:x-sync-token',
    fallback: {
      filename: body.filename,
      rowTotal: body.rowTotal,
      windowFrom: body.windowFrom,
      windowTo: body.windowTo,
    },
  });
  if (start.status === 'unknown_upload') {
    return NextResponse.json(
      { error: 'unknown_upload', message: 'El archivo cargado ya no está disponible. Volvé a subirlo.' },
      { status: 400 },
    );
  }
  if (start.status === 'already_running') {
    return NextResponse.json({ status: 'already_running', startedAt: null }, { status: 202 });
  }

  startedAt = Date.now();
  lastError = null;
  lastResult = {};

  void start.run.then((outcome) => {
    if (outcome.ok) {
      lastResult = { ...lastResult, basket: outcome.result, upload: { uploadId: body.uploadId, ...outcome.upload } };
    } else {
      lastError = `basket: ${outcome.error}`;
    }
  });

  const partidosP = composeSyncPartidos()
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
