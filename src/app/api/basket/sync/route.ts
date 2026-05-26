import { NextResponse, type NextRequest } from 'next/server';
import { composeRunSync } from '@basket/infrastructure/sync/composeRunSync';
import { DrizzleSyncStateRepository } from '@basket/infrastructure/db/repositories/DrizzleSyncStateRepository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let inFlight: Promise<unknown> | null = null;
let startedAt: number | null = null;
let lastError: string | null = null;
let lastResult: unknown = null;

export async function GET() {
  const repo = new DrizzleSyncStateRepository();
  const rows = await repo.findAll();
  return NextResponse.json({
    sources: rows.map((r) => ({
      source: r.source,
      lastSync: r.lastSync.toISOString(),
      rowCount: r.rowCount,
    })),
    inFlight: inFlight !== null,
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    lastError,
    lastResult,
  });
}

export async function POST(req: NextRequest) {
  const expected = process.env.SYNC_TOKEN;
  if (expected) {
    const got = req.headers.get('x-sync-token');
    if (got !== expected) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  if (inFlight) {
    return NextResponse.json(
      { status: 'already_running', startedAt: startedAt ? new Date(startedAt).toISOString() : null },
      { status: 202 },
    );
  }

  const useCase = await composeRunSync();
  startedAt = Date.now();
  lastError = null;
  const promise = useCase.execute();
  inFlight = promise;
  promise
    .then((result) => {
      lastResult = result;
    })
    .catch((err) => {
      lastError = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      inFlight = null;
    });

  return NextResponse.json(
    { status: 'started', startedAt: new Date(startedAt).toISOString() },
    { status: 202 },
  );
}
