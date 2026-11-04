import { NextResponse, type NextRequest } from 'next/server';
import { scrubMessage } from 'basket-tv-telemetry';
import { withRequestLog } from 'basket-tv-telemetry/next';
import { runLoggedSync } from '@basket/infrastructure/sync/runLoggedSync';
import { scrubErrorFields } from '@/lib/telemetry';
import { DrizzleSyncStateRepository } from '@basket/infrastructure/db/repositories/DrizzleSyncStateRepository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let inFlight: Promise<unknown> | null = null;
let startedAt: number | null = null;
let lastError: string | null = null;
let lastResult: unknown = null;

export const GET = withRequestLog('/api/basket/sync', async () => {
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
});

export const POST = withRequestLog('/api/basket/sync', async (req: NextRequest) => {
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

  startedAt = Date.now();
  lastError = null;
  // Its own job line, with this request's id; this request's line ends at the 202.
  const promise = runLoggedSync('token', 'x-sync-token');
  inFlight = promise;
  promise
    .then((result) => {
      // GET answers both: every error string in them is scrubbed.
      lastResult = scrubErrorFields(result);
    })
    .catch((err) => {
      lastError = scrubMessage(err instanceof Error ? err.message : String(err));
    })
    .finally(() => {
      inFlight = null;
    });

  return NextResponse.json(
    { status: 'started', startedAt: new Date(startedAt).toISOString() },
    { status: 202 },
  );
});
