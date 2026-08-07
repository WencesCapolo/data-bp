'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { KpiCard } from '@/components/ui/KpiCard';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import type { TeamDailyDTO, TeamRankRow } from '@basket/core/dtos/TeamsDTO';
import { BUCKETS, bucketize, type Bucket } from './buckets';
import { netColor, signed } from './format';
import { TeamMovementChart } from './TeamMovementChart';

interface Props {
  team: TeamRankRow;
  filterQS: string;
  from: string;
  to: string;
}

export function TeamDetail({ team, filterQS, from, to }: Props) {
  const [bucket, setBucket] = useState<Bucket>('day');
  const { data, error } = useSWR<TeamDailyDTO>(
    `/api/basket/teams/${team.teamId}/daily?${filterQS}`,
    fetcher,
    { keepPreviousData: true },
  );

  const series = useMemo(
    () =>
      bucketize(
        data?.days ?? [],
        { altas: data?.altas ?? [], bajas: data?.bajas ?? [], active: data?.activeSubs ?? [] },
        bucket,
      ),
    [data, bucket],
  );

  const rows = useMemo(
    () =>
      series.keys
        .map((key, i) => ({
          key,
          label: series.labels[i],
          altas: series.altas[i],
          bajas: series.bajas[i],
          active: series.active[i],
        }))
        .filter((r) => r.altas + r.bajas > 0)
        .reverse(),
    [series],
  );

  const header = (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{team.teamName}</div>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>
        {team.league} · {team.teamCountry} · {from} → {to}
      </div>
    </div>
  );

  if (error) {
    return (
      <div>
        {header}
        <ErrorBox message={error.message} />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        {header}
        <TabSkeleton kpis={5} blocks={[{ kind: 'full', height: 320 }, { kind: 'full', height: 240 }]} />
      </div>
    );
  }

  const activeStart = data.activeSubs[0] ?? 0;
  const activeEnd = data.activeSubs[data.activeSubs.length - 1] ?? 0;
  const followerConversion = ((team.activeSubs / Math.max(1, team.followers)) * 100).toFixed(1);
  const bucketLabelText = BUCKETS.find((b) => b.key === bucket)?.label ?? '';

  return (
    <div>
      {header}

      <div className="kpi-grid">
        <KpiCard
          label="Suscripciones activas"
          value={activeEnd}
          variant="blue"
          sub={`${activeStart.toLocaleString()} al inicio del rango`}
          delta={{ value: `${signed(activeEnd - activeStart)} en el rango`, up: activeEnd >= activeStart }}
        />
        <KpiCard label="Altas de suscripción" value={team.altas} variant="green" />
        <KpiCard label="Bajas de suscripción" value={team.bajas} variant="red" />
        <KpiCard
          label="Variación neta"
          value={signed(team.net)}
          variant={team.net >= 0 ? 'green' : 'red'}
          sub={`sobre una base de ${activeEnd.toLocaleString()} activas`}
        />
        <KpiCard
          label="Seguidores"
          value={team.followers}
          sub={`${followerConversion}% con suscripción activa`}
        />
      </div>

      <div className="chart-full">
        <div
          className="chart-title"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
        >
          <span>
            Suscripciones activas y su variación
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400, marginLeft: 8 }}>
              barras = altas / bajas · línea = activas al cierre del período
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
        <TeamMovementChart series={series} bucket={bucket} />
      </div>

      <div className="chart-full" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{bucketLabelText}</th>
              <th style={{ textAlign: 'right' }}>Activas</th>
              <th style={{ textAlign: 'right' }}>Altas</th>
              <th style={{ textAlign: 'right' }}>Bajas</th>
              <th style={{ textAlign: 'right' }}>Neto</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="no-data">
                  Sin movimientos en el rango
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{bucket === 'day' ? r.key : r.label}</td>
                <td style={{ textAlign: 'right', color: 'var(--accent2)' }}>{r.active.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: 'var(--green)' }}>{r.altas}</td>
                <td style={{ textAlign: 'right', color: 'var(--red)' }}>{r.bajas}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: netColor(r.altas - r.bajas) }}>
                  {signed(r.altas - r.bajas)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
