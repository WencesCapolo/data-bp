'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { KpiCard } from '@/components/ui/KpiCard';
import { InfoHint } from '@/components/ui/InfoHint';
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

  const title = (
    <div className="chart-title" style={{ marginBottom: 12 }}>
      Base de usuarios
      <InfoHint text="Las cuentas del Platform y su relación con las Subscriptions: cuántas existen, cuántas pagaron alguna vez y cómo se mueven las altas frente a la base activa." />
    </div>
  );

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
        <KpiCard
          label="Usuarios totales"
          value={funnel.totalUsers}
          sub={usersNote ?? `al ${data.to}`}
          hint="Cuentas habilitadas en el Platform creadas hasta el último día del rango. Solo responde al filtro de país: el de acceso o Tier no aplica a quien nunca pagó."
        />
        <KpiCard
          label="Verificados"
          value={funnel.verifiedUsers}
          sub={usersNote ?? pct(funnel.verifiedUsers, funnel.totalUsers)}
          hint="De esas cuentas, las que confirmaron su email. Mismo corte de fecha y, al igual que Usuarios totales, solo responde al filtro de país."
        />
        <KpiCard
          label="Con suscripción alguna vez"
          value={funnel.everSubscribed}
          variant="blue"
          sub={pct(funnel.everSubscribed, funnel.totalUsers)}
          hint="Suscriptores distintos con al menos un Pago exitoso hasta el último día del rango, tengan o no una Subscription vigente. Incluye vouchers, Antel y Free."
        />
        <KpiCard
          label="Activos sin suscripción"
          value={funnel.activeNoSub}
          variant="yellow"
          sub={usersNote ? `${loginNote} · ${usersNote}` : loginNote}
          hint="Cuentas que iniciaron sesión en los últimos 30 días y hoy no tienen Subscription vigente (con 7 días de gracia). El Platform guarda solo el último login, por eso no sigue el rango."
        />
        <KpiCard
          label="Nunca suscritos"
          value={funnel.neverSubscribed}
          sub={usersNote ? `${loginNote} · ${usersNote}` : loginNote}
          hint="Cuentas que iniciaron sesión en los últimos 30 días y jamás tuvieron un Pago exitoso. Siempre medido a hoy: el Platform guarda solo el último login."
        />
      </div>

      <div className="chart-full">
        <div
          className="chart-title"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
        >
          <span>
            Altas de suscripción y base activa
            <InfoHint text="Barras: cada Suscriptor que pagó ese día, como nuevo (primer Pago de su historia), reactivación (más de 37 días tras vencer) o renovación. Línea: Subscriptions vigentes al cierre de cada punto." />
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
