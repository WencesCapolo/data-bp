import { NextResponse, type NextRequest } from 'next/server';
import { composeRunSync } from '@basket/infrastructure/sync/composeRunSync';
import { DrizzleSyncStateRepository } from '@basket/infrastructure/db/repositories/DrizzleSyncStateRepository';
import { composeSyncPartidos } from '@partidos/infrastructure/sync/composeSyncPartidos';
import { DrizzlePartidosSyncStateRepository } from '@partidos/infrastructure/db/repositories/DrizzlePartidosSyncStateRepository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let basketInFlight: Promise<unknown> | null = null;
let partidosInFlight: Promise<unknown> | null = null;
let startedAt: number | null = null;
let lastError: string | null = null;
let lastResult: { basket?: unknown; partidos?: unknown } = {};

function checkToken(req: NextRequest): NextResponse | null {
  const expected = process.env.SYNC_TOKEN;
  if (!expected) return null;
  const got = req.headers.get('x-sync-token');
  if (got !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
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
  const denied = checkToken(req);
  if (denied) return denied;

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

  const basketUseCase = await composeRunSync();
  const partidosUseCase = composeSyncPartidos();

  const basketP = basketUseCase
    .execute()
    .then((r) => {
      lastResult = { ...lastResult, basket: r };
    })
    .catch((err) => {
      lastError = `basket: ${err instanceof Error ? err.message : String(err)}`;
    })
    .finally(() => {
      basketInFlight = null;
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
