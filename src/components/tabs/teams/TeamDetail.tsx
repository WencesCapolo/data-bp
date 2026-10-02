'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard';
import { Card } from '@/components/ui/Card';
import { PillGroup } from '@/components/ui/PillGroup';
import { InfoHint } from '@/components/ui/InfoHint';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import type { TeamDailyDTO, TeamRankRow } from '@basket/core/dtos/TeamsDTO';
import { BUCKETS, bucketize, type Bucket } from './buckets';
import { netClass, signed } from './format';
import { TeamMovementChart } from './TeamMovementChart';

const BUCKET_OPTIONS = BUCKETS.map((b) => ({ val: b.key, label: b.label }));

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
    <div>
      <h2 className="font-display text-2xl font-semibold tracking-tight">{team.teamName}</h2>
      <p className="mt-0.5 text-xs text-muted">
        {team.league} · {team.teamCountry} · {from} → {to}
      </p>
    </div>
  );

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <ErrorBox message={error.message} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
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
    <div className="flex flex-col gap-4">
      {header}

      <KpiGrid>
        <KpiCard
          label="Suscripciones activas"
          value={activeEnd}
          variant="blue"
          sub={`${activeStart.toLocaleString()} al inicio del rango`}
          delta={{ value: `${signed(activeEnd - activeStart)} en el rango`, up: activeEnd >= activeStart }}
          hint="Suscriptores de este equipo con acceso vigente el último día del rango: un Pago exitoso cuyo vencimiento, más 7 días de gracia, todavía no pasó. El subtítulo repite el conteo para el primer día del rango."
        />
        <KpiCard
          label="Altas de suscripción"
          value={team.altas}
          variant="green"
          hint="Suscriptores del equipo que pasaron de no tener acceso a tenerlo en algún día del rango: un primer Pago o una reactivación. Una renovación sin corte de acceso no cuenta como alta."
        />
        <KpiCard
          label="Bajas de suscripción"
          value={team.bajas}
          variant="red"
          hint="Suscriptores del equipo cuyo acceso se cortó en algún día del rango: el vencimiento más 7 días de gracia pasó sin otro Pago que lo cubra. Por esa gracia, la baja aparece unos 7 días después del vencimiento real."
        />
        <KpiCard
          label="Variación neta"
          value={signed(team.net)}
          variant={team.net >= 0 ? 'green' : 'red'}
          sub={`sobre una base de ${activeEnd.toLocaleString()} activas`}
          hint="Altas menos bajas del equipo dentro del rango. Positivo: la base de suscripciones activas creció; negativo: se achicó."
        />
        <KpiCard
          label="Seguidores"
          value={team.followers}
          sub={`${followerConversion}% con suscripción activa`}
          hint="Suscriptores que tienen a este equipo como favorito, paguen o no. No lo afectan los filtros de plan ni tipo de acceso. El subtítulo indica qué porcentaje de ellos tiene una suscripción activa al cierre del rango."
        />
      </KpiGrid>

      <Card
        title="Suscripciones activas y su variación"
        hint="Barras: altas hacia arriba y bajas hacia abajo, sumadas por día, semana o mes. Línea: Suscripciones activas al cierre de cada período, en su propio eje. El movimiento se atribuye al equipo favorito actual de cada suscriptor."
        desc="barras = altas / bajas · línea = activas al cierre del período"
        actions={<PillGroup options={BUCKET_OPTIONS} value={bucket} onChange={setBucket} label="Agrupar por" />}
      >
        <TeamMovementChart series={series} bucket={bucket} />
      </Card>

      <div className="card overflow-x-auto">
        <table className="data-table min-w-[560px]">
          <thead>
            <tr>
              <th>
                {bucketLabelText}
                <InfoHint text="Solo los períodos con alguna alta o baja, del más reciente al más antiguo. Activas = suscripciones vigentes al cierre del período; Neto = altas menos bajas." />
              </th>
              <th className="text-right!">Activas</th>
              <th className="text-right!">Altas</th>
              <th className="text-right!">Bajas</th>
              <th className="text-right!">Neto</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10! text-center text-muted!">
                  Sin movimientos en el rango
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{bucket === 'day' ? r.key : r.label}</td>
                <td className="text-right text-sky-700! tabular-nums">{r.active.toLocaleString()}</td>
                <td className="text-right text-[var(--ok)]! tabular-nums">{r.altas}</td>
                <td className="text-right text-red-700! tabular-nums">{r.bajas}</td>
                <td className="text-right font-bold tabular-nums">
                  <span className={netClass(r.altas - r.bajas)}>{signed(r.altas - r.bajas)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
