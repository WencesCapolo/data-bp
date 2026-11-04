import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth/getSessionUser';
import { serverError, unauthorized } from '@/lib/api/responses';
import { runPartidosSync } from '@partidos/infrastructure/sync/composeSyncPartidos';
import { DrizzlePartidosSyncStateRepository } from '@partidos/infrastructure/db/repositories/DrizzlePartidosSyncStateRepository';
import type { PartidosSyncStateDTO } from '@partidos/core/dtos/PartidosSyncDTO';
import { scrubMessage } from 'basket-tv-telemetry';
import { telemetry } from '@/lib/telemetry';
import { withRequestLog } from 'basket-tv-telemetry/next';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let inFlight: Promise<unknown> | null = null;
let startedAt: number | null = null;

export const GET = withRequestLog('/api/partidos/sync', async (): Promise<NextResponse> => {
  if (!(await getSessionUser())) return unauthorized();
  const state = await new DrizzlePartidosSyncStateRepository().get();
  const dto: PartidosSyncStateDTO = {
    lastSyncAt: state.lastSyncAt ? state.lastSyncAt.toISOString() : null,
    lastCountNacional: state.lastCountNacional,
    lastCountIntl: state.lastCountIntl,
    // Rows stored before the sync scrubbed its error are scrubbed here.
    lastError: state.lastError ? scrubMessage(state.lastError) : null,
    lastDurationMs: state.lastDurationMs,
  };
  return NextResponse.json({
    ...dto,
    inFlight: inFlight !== null,
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
  });
});

export const POST = withRequestLog('/api/partidos/sync', async (req: NextRequest): Promise<NextResponse> => {
  const expected = process.env.SYNC_TOKEN;
  if (expected) {
    const got = req.headers.get('x-sync-token');
    if (got !== expected) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  if (inFlight) {
    return NextResponse.json(
      {
        status: 'already_running',
        startedAt: startedAt ? new Date(startedAt).toISOString() : null,
      },
      { status: 202 },
    );
  }

  startedAt = Date.now();
  // Its own job line, with this request's id, like the syncs that outlive their request.
  const promise = runPartidosSync('token');
  inFlight = promise;
  // The rejection is handled by the await below; this branch only clears the flag.
  promise
    .finally(() => {
      inFlight = null;
    })
    .catch(() => {});

  try {
    const result = await promise;
    telemetry.trackServerEvent('partidos_synced', null, {
      count_nacional: result.countNacional,
      count_intl: result.countIntl,
      duration_ms: result.durationMs,
    });
    return NextResponse.json(result);
  } catch (err) {
    // The use case stored the message as the sync state's lastError; the job reported it.
    return serverError(err);
  }
});
