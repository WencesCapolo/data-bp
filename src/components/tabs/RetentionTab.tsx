'use client';
import { useMemo } from 'react';
import useSWR from 'swr';
import type { ChartConfiguration } from 'chart.js';
import { fetcher } from '@/lib/client/fetcher';
import { KpiCard } from '@/components/ui/KpiCard';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { ChartCanvas } from '@/components/charts/ChartCanvas';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import type { RetentionDTO } from '@basket/core/dtos/RetentionDTO';
import { bucketTitles } from '@/lib/client/bucketTitle';
import { tooltipOpts } from '@/components/charts/tooltip';

const COLORS = {
  newPayers: '#10b981',
  renewals: '#06b6d4',
  reactivations: '#a78bfa',
  expirations: '#ef4444',
};

export function RetentionTab() {
  const { data, error, isLoading } = useSWR<RetentionDTO>('/api/basket/retention', fetcher);

  const churnLineConfig = useMemo<ChartConfiguration | null>(() => {
    if (!data || data.rows.length === 0) return null;
    const labels = data.rows.map((r) => r.month.slice(0, 7));
    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Churn %',
            data: data.rows.map((r) => r.churnRatePct),
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.1)',
            yAxisID: 'y',
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2,
            fill: true,
          },
          {
            label: 'Retención %',
            data: data.rows.map((r) => r.retentionRatePct),
            borderColor: '#10b981',
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
          tooltip: tooltipOpts(bucketTitles(labels, 'month')),
        },
        scales: {
          x: { grid: { color: '#1e2a42' }, ticks: { autoSkip: true, maxTicksLimit: 14 } },
          y: {
            grid: { color: '#1e2a42' },
            beginAtZero: true,
            max: 100,
            ticks: { callback: (v) => `${v}%` },
          },
        },
      },
    };
  }, [data]);

  if (isLoading) return <TabSkeleton kpis={4} blocks={[{ kind: 'full', height: 340 }, { kind: 'full', height: 300 }, { kind: 'full', height: 280 }]} />;
  if (error) return <ErrorBox message={error.message} />;
  if (!data) return null;
  if (data.rows.length === 0) return <div className="no-data">Sin datos de lifecycle</div>;

  const last = data.rows[data.rows.length - 1];
  const avgChurn =
    data.rows.reduce((s, r) => s + r.churnRatePct, 0) / data.rows.length;
  const avgRetention =
    data.rows.reduce((s, r) => s + r.retentionRatePct, 0) / data.rows.length;
  const labels = data.rows.map((r) => r.month.slice(0, 7));

  return (
    <div>
      <div className="kpi-grid">
        <KpiCard
          label="Churn último mes"
          value={`${last.churnRatePct.toFixed(1)}%`}
          sub={last.month.slice(0, 7)}
          variant="red"
        />
        <KpiCard
          label="Retención último mes"
          value={`${last.retentionRatePct.toFixed(1)}%`}
          variant="green"
        />
        <KpiCard label="Churn promedio" value={`${avgChurn.toFixed(1)}%`} />
        <KpiCard label="Retención promedio" value={`${avgRetention.toFixed(1)}%`} variant="blue" />
      </div>

      <div className="chart-full">
        <div className="chart-title">Lifecycle mensual</div>
        <div style={{ height: 320 }}>
          <StackedBarChart
            height={320}
            labels={labels}
            tooltipTitles={bucketTitles(labels, 'month')}
            series={[
              { label: 'Nuevos', data: data.rows.map((r) => r.newPayers), color: COLORS.newPayers },
              { label: 'Renovaciones', data: data.rows.map((r) => r.renewals), color: COLORS.renewals },
              { label: 'Reactivaciones', data: data.rows.map((r) => r.reactivations), color: COLORS.reactivations },
              { label: 'Expiraciones', data: data.rows.map((r) => -r.expirations), color: COLORS.expirations },
            ]}
          />
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text3)' }}>
          Expiraciones mostradas como negativo para ver flujo neto.
        </div>
      </div>

      <div className="chart-full">
        <div className="chart-title">Churn y retención · %</div>
        <div style={{ height: 280 }}>
          {churnLineConfig && <ChartCanvas config={churnLineConfig} height={280} />}
        </div>
      </div>

      <div className="chart-full" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Mes</th>
              <th style={{ textAlign: 'right' }}>Inicio</th>
              <th style={{ textAlign: 'right' }}>Fin</th>
              <th style={{ textAlign: 'right' }}>Nuevos</th>
              <th style={{ textAlign: 'right' }}>Renov.</th>
              <th style={{ textAlign: 'right' }}>Reactiv.</th>
              <th style={{ textAlign: 'right' }}>Expir.</th>
              <th style={{ textAlign: 'right' }}>Churn %</th>
              <th style={{ textAlign: 'right' }}>Retención %</th>
            </tr>
          </thead>
          <tbody>
            {[...data.rows].reverse().map((r) => (
              <tr key={r.month}>
                <td>{r.month.slice(0, 7)}</td>
                <td style={{ textAlign: 'right' }}>{r.activeStart.toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>{r.activeEnd.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: 'var(--green)' }}>{r.newPayers.toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>{r.renewals.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: 'var(--accent2)' }}>{r.reactivations.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: 'var(--red)' }}>{r.expirations.toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>{r.churnRatePct.toFixed(1)}%</td>
                <td style={{ textAlign: 'right' }}>{r.retentionRatePct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

