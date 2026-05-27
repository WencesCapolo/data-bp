import { NextResponse } from 'next/server';
import { requireDashboard, requireRole } from '@/lib/auth/rbac';
import { composeSyncPartidos } from '@partidos/infrastructure/sync/composeSyncPartidos';
import { DrizzlePartidosSyncStateRepository } from '@partidos/infrastructure/db/repositories/DrizzlePartidosSyncStateRepository';
import type { PartidosSyncStateDTO } from '@partidos/core/dtos/PartidosSyncDTO';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let inFlight: Promise<unknown> | null = null;
let startedAt: number | null = null;

export async function GET(): Promise<NextResponse> {
  await requireDashboard('partidos');
  const state = await new DrizzlePartidosSyncStateRepository().get();
  const dto: PartidosSyncStateDTO = {
    lastSyncAt: state.lastSyncAt ? state.lastSyncAt.toISOString() : null,
    lastCountNacional: state.lastCountNacional,
    lastCountIntl: state.lastCountIntl,
    lastError: state.lastError,
    lastDurationMs: state.lastDurationMs,
  };
  return NextResponse.json({
    ...dto,
    inFlight: inFlight !== null,
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
  });
}

export async function POST(): Promise<NextResponse> {
  await requireRole('admin');

  if (inFlight) {
    return NextResponse.json(
      {
        status: 'already_running',
        startedAt: startedAt ? new Date(startedAt).toISOString() : null,
      },
      { status: 202 },
    );
  }

  const useCase = composeSyncPartidos();
  startedAt = Date.now();
  const promise = useCase.execute();
  inFlight = promise;
  promise.finally(() => {
    inFlight = null;
  });

  try {
    const result = await promise;
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
