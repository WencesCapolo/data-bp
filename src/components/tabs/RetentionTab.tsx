'use client';
import { useMemo } from 'react';
import useSWR from 'swr';
import type { ChartConfiguration } from 'chart.js';
import { fetcher } from '@/lib/client/fetcher';
import { useFilterQS, useFilters } from '@/lib/client/filterStore';
import type { Granularity } from '@basket/core/dtos/shared';
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard';
import { Card } from '@/components/ui/Card';
import { InfoHint } from '@/components/ui/InfoHint';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { ChartCanvas } from '@/components/charts/ChartCanvas';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import type { RetentionDTO } from '@basket/core/dtos/RetentionDTO';
import { bucketTitle, bucketTitles } from '@/lib/client/bucketTitle';
import { tooltipOpts } from '@/components/charts/tooltip';
import { CHART_THEME, SERIES, TREND } from '@/lib/client/palette';

// Copy per bucket unit. Labels abbreviate like Evolution: months keep the
// year, days and weeks drop it and lean on the tooltip for the full span.
const UNIT: Record<Granularity, { one: string; many: string; adj: string; last: string }> = {
  day: { one: 'día', many: 'días', adj: 'diario', last: 'último día' },
  week: { one: 'semana', many: 'semanas', adj: 'semanal', last: 'última semana' },
  month: { one: 'mes', many: 'meses', adj: 'mensual', last: 'último mes' },
};

function bucketLabel(bucket: string, g: Granularity): string {
  return g === 'month' ? bucket.slice(0, 7) : bucket.slice(5);
}

const COLORS = {
  newPayers: TREND.up,
  renewals: SERIES[1],
  reactivations: SERIES[3],
  expirations: TREND.down,
};

export function RetentionTab() {
  const filterQS = useFilterQS({ lifecycleGranularity: true });
  const g = useFilters((s) => s.lifecycleGranularity);
  const u = UNIT[g];
  const { data, error, isLoading } = useSWR<RetentionDTO>(
    `/api/basket/retention?${filterQS}`,
    fetcher,
    { keepPreviousData: true },
  );

  const churnLineConfig = useMemo<ChartConfiguration | null>(() => {
    if (!data || data.rows.length === 0) return null;
    const labels = data.rows.map((r) => bucketLabel(r.bucket, g));
    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Churn %',
            data: data.rows.map((r) => r.churnRatePct),
            borderColor: TREND.down,
            backgroundColor: 'rgba(192,20,27,0.08)',
            yAxisID: 'y',
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
            fill: true,
          },
          {
            label: 'Retención %',
            data: data.rows.map((r) => r.retentionRatePct),
            borderColor: TREND.up,
            backgroundColor: 'transparent',
            yAxisID: 'y',
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { boxWidth: 10 } },
          tooltip: tooltipOpts(bucketTitles(data.rows.map((r) => r.bucket), g)),
        },
        scales: {
          x: { grid: { color: CHART_THEME.grid }, ticks: { autoSkip: true, maxTicksLimit: 14 } },
          y: {
            grid: { color: CHART_THEME.grid },
            beginAtZero: true,
            max: 100,
            ticks: { callback: (v) => `${v}%` },
          },
        },
      },
    };
  }, [data, g]);

  if (isLoading) return <TabSkeleton kpis={4} blocks={[{ kind: 'full', height: 340 }, { kind: 'full', height: 300 }, { kind: 'full', height: 280 }]} />;
  if (error) return <ErrorBox message={error.message} />;
  if (!data) return null;
  if (data.rows.length === 0) return <div className="card p-10 text-center text-sm text-muted">Sin datos de lifecycle</div>;

  const last = data.rows[data.rows.length - 1];
  const avgChurn =
    data.rows.reduce((s, r) => s + r.churnRatePct, 0) / data.rows.length;
  const avgRetention =
    data.rows.reduce((s, r) => s + r.retentionRatePct, 0) / data.rows.length;
  const labels = data.rows.map((r) => bucketLabel(r.bucket, g));
  const titles = bucketTitles(data.rows.map((r) => r.bucket), g);

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard
          label={`Churn ${u.last}`}
          value={`${last.churnRatePct.toFixed(1)}%`}
          sub={bucketLabel(last.bucket, g)}
          variant="red"
          hint={`Expiraciones del ${u.last} cerrado divididas por los suscriptores activos al inicio de ese ${u.one}. Un suscriptor expira cuando su acceso vence (más 7 días de gracia) sin otro Pago exitoso que lo cubra.`}
        />
        <KpiCard
          label={`Retención ${u.last}`}
          value={`${last.retentionRatePct.toFixed(1)}%`}
          variant="green"
          hint={`Porcentaje de los suscriptores activos al inicio del ${u.last} cerrado que seguían con acceso al terminarlo. Es el complemento del churn: retención = 100 − churn.`}
        />
        <KpiCard
          label="Churn promedio"
          value={`${avgChurn.toFixed(1)}%`}
          hint={`Promedio simple del churn ${u.adj} de los ${u.many} que muestra la tabla. Cada ${u.one} pesa igual, sin importar cuántos suscriptores tenía.`}
        />
        <KpiCard
          label="Retención promedio"
          value={`${avgRetention.toFixed(1)}%`}
          variant="blue"
          hint={`Promedio simple de la retención ${u.adj} de los ${u.many} que muestra la tabla. Cada ${u.one} pesa igual, sin importar cuántos suscriptores tenía.`}
        />
      </KpiGrid>

      <Card
        title={`Lifecycle ${u.adj}`}
        hint={`Movimiento de suscriptores por ${u.one}, a partir de Pagos exitosos de todos los proveedores. Nuevos = ${u.one} del primer Pago; Renovaciones = Pago hasta 37 días después del vencimiento anterior; Reactivaciones = Pago pasado ese plazo; Expiraciones = acceso vencido (+7 días) sin otro Pago.`}
      >
        <StackedBarChart
          height={320}
          labels={labels}
          tooltipTitles={titles}
          series={[
            { label: 'Nuevos', data: data.rows.map((r) => r.newPayers), color: COLORS.newPayers },
            { label: 'Renovaciones', data: data.rows.map((r) => r.renewals), color: COLORS.renewals },
            { label: 'Reactivaciones', data: data.rows.map((r) => r.reactivations), color: COLORS.reactivations },
            { label: 'Expiraciones', data: data.rows.map((r) => -r.expirations), color: COLORS.expirations },
          ]}
        />
        <div className="mt-2 text-[11px] text-muted">
          Expiraciones mostradas como negativo para ver flujo neto. {g === 'month' ? 'El mes' : g === 'week' ? 'La semana' : 'El día'} en curso
          se excluye hasta cerrar: sus expiraciones aún no vencieron y sus
          renovaciones aún no ocurrieron.
        </div>
      </Card>

      <Card
        title="Churn y retención · %"
        hint={`Churn = expiraciones del ${u.one} sobre los suscriptores activos el primer día del ${u.one}; retención = 100 − churn. Respeta los filtros de país, plan y tipo de acceso. El ${u.one} en curso no se muestra hasta que cierra.`}
      >
        <div className="h-[280px]">
          {churnLineConfig && <ChartCanvas config={churnLineConfig} height={280} />}
        </div>
      </Card>

      <div className="card overflow-x-auto">
        <table className="data-table min-w-[720px]">
          <thead>
            <tr>
              <th>
                {u.one.charAt(0).toUpperCase() + u.one.slice(1)}
                <InfoHint text={`Una fila por ${u.one} cerrado, del más reciente al más antiguo. Inicio y Fin = suscriptores con acceso vigente el primer y el último día del ${u.one}; las demás columnas son los movimientos del gráfico de lifecycle.`} />
              </th>
              <th className="text-right!">Inicio</th>
              <th className="text-right!">Fin</th>
              <th className="text-right!">Nuevos</th>
              <th className="text-right!">Renov.</th>
              <th className="text-right!">Reactiv.</th>
              <th className="text-right!">Expir.</th>
              <th className="text-right!">Churn %</th>
              <th className="text-right!">Retención %</th>
            </tr>
          </thead>
          <tbody>
            {[...data.rows].reverse().map((r) => (
              <tr key={r.bucket}>
                <td title={bucketTitle(r.bucket, g)}>{g === 'month' ? r.bucket.slice(0, 7) : r.bucket}</td>
                <td className="text-right tabular-nums">{r.activeStart.toLocaleString()}</td>
                <td className="text-right tabular-nums">{r.activeEnd.toLocaleString()}</td>
                <td className="text-right text-[var(--ok)]! tabular-nums">{r.newPayers.toLocaleString()}</td>
                <td className="text-right tabular-nums">{r.renewals.toLocaleString()}</td>
                <td className="text-right text-sky-700! tabular-nums">{r.reactivations.toLocaleString()}</td>
                <td className="text-right text-red-700! tabular-nums">{r.expirations.toLocaleString()}</td>
                <td className="text-right tabular-nums">{r.churnRatePct.toFixed(1)}%</td>
                <td className="text-right tabular-nums">{r.retentionRatePct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
