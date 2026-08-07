'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { KpiCard } from '@/components/ui/KpiCard';
import { ChartSkeleton, KpiGridSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import { BUCKETS, bucketize, type Bucket } from '@/lib/client/buckets';
import { UserBaseChart, type MovementSeries } from './UserBaseChart';
import type { LifecycleDTO } from '@basket/core/dtos/LifecycleDTO';

const pct = (part: number, whole: number): string =>
  `${((part / Math.max(1, whole)) * 100).toFixed(1)}% del total`;

export function UserBaseSection({ filterQS }: { filterQS: string }) {
  const [bucket, setBucket] = useState<Bucket>('day');
  const { data, error, isLoading } = useSWR<LifecycleDTO>(
    `/api/basket/overview/lifecycle?${filterQS}`,
    fetcher,
    { refreshInterval: 300_000, keepPreviousData: true },
  );

  const series = useMemo<MovementSeries>(() => {
    const s = data?.series ?? [];
    return bucketize(
      s.map((p) => p.day),
      {
        nuevos: s.map((p) => p.nuevos),
        reactivaciones: s.map((p) => p.reactivaciones),
        renovaciones: s.map((p) => p.renovaciones),
      },
      { activeSubs: s.map((p) => p.activeSubs) },
      bucket,
    );
  }, [data, bucket]);

  const title = <div className="chart-title" style={{ marginBottom: 12 }}>Base de usuarios</div>;

  if (error) {
    return (
      <div style={{ marginBottom: 24 }}>
        {title}
        <ErrorBox message={error.message} />
      </div>
    );
  }
  if (isLoading && !data) {
    return (
      <div style={{ marginBottom: 24 }}>
        {title}
        <KpiGridSkeleton count={5} />
        <ChartSkeleton height={300} />
      </div>
    );
  }
  if (!data) return null;

  const { funnel } = data;
  // accessType/subType have no meaning for a user without payments, so the two
  // user-side cards report them unfiltered and say so rather than silently
  // turning "usuarios totales" into "pagadores de ese tipo".
  const usersNote = data.accessFilterIgnoredOnUsers
    ? 'no aplica al filtro de acceso/subtipo'
    : undefined;
  // login_at is a single overwritten timestamp — there is no history to walk
  // back, so these two are always as of today whatever the range says.
  const loginNote = 'últimos 30 días, a hoy';

  return (
    <div style={{ marginBottom: 24 }}>
      {title}

      <div className="kpi-grid">
        <KpiCard label="Usuarios totales" value={funnel.totalUsers} sub={usersNote ?? `al ${data.to}`} />
        <KpiCard
          label="Verificados"
          value={funnel.verifiedUsers}
          sub={usersNote ?? pct(funnel.verifiedUsers, funnel.totalUsers)}
        />
        <KpiCard
          label="Con suscripción alguna vez"
          value={funnel.everSubscribed}
          variant="blue"
          sub={pct(funnel.everSubscribed, funnel.totalUsers)}
        />
        <KpiCard
          label="Activos sin suscripción"
          value={funnel.activeNoSub}
          variant="yellow"
          sub={usersNote ? `${loginNote} · ${usersNote}` : loginNote}
        />
        <KpiCard
          label="Nunca suscritos"
          value={funnel.neverSubscribed}
          sub={usersNote ? `${loginNote} · ${usersNote}` : loginNote}
        />
      </div>

      <div className="chart-full">
        <div
          className="chart-title"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
        >
          <span>
            Altas de suscripción y base activa
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400, marginLeft: 8 }}>
              barras = nuevos / reactivaciones / renovaciones · línea = suscriptores activos al cierre
            </span>
          </span>
          <span className="subtype-pills">
            {BUCKETS.map((b) => (
              <button
                key={b.key}
                className={`subtype-pill ${bucket === b.key ? 'active' : ''}`}
                onClick={() => setBucket(b.key)}
              >
                {b.label}
              </button>
            ))}
          </span>
        </div>
        <UserBaseChart series={series} bucket={bucket} />
      </div>
    </div>
  );
}
