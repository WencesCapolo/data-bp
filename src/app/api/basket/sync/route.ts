import { NextResponse, type NextRequest } from 'next/server';
import { composeRunSync } from '@basket/infrastructure/sync/composeRunSync';
import { DrizzleSyncStateRepository } from '@basket/infrastructure/db/repositories/DrizzleSyncStateRepository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let inFlight: Promise<unknown> | null = null;

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
    return NextResponse.json({ error: 'sync already running' }, { status: 409 });
  }

  const useCase = await composeRunSync();
  const promise = useCase.execute();
  inFlight = promise;
  try {
    const result = await promise;
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    inFlight = null;
  }
}
