'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '@/components/charts/ChartCanvas';
import { bucketTitles } from '@/lib/client/bucketTitle';
import { tooltipOpts } from '@/components/charts/tooltip';
import type { Bucket, Bucketed } from '@/lib/client/buckets';

const CHART_HEIGHT = 300;

export type MovementSeries = Bucketed<'nuevos' | 'reactivaciones' | 'renovaciones', 'activeSubs'>;

// Stacked bars = the three ways a subscription starts or continues in the
// period; line = subscribers active at its close, on its own axis, so movement
// is read against the base it moves.
export function UserBaseChart({ series, bucket }: { series: MovementSeries; bucket: Bucket }) {
  const config = useMemo<ChartConfiguration>(() => {
    const dated = tooltipOpts(bucketTitles(series.keys, bucket));
    return {
      type: 'bar',
      data: {
        labels: series.labels,
        datasets: [
          {
            type: 'line',
            label: 'Suscriptores activos',
            data: series.stocks.activeSubs,
            borderColor: '#06b6d4',
            backgroundColor: 'rgba(6,182,212,.12)',
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            tension: 0.25,
            yAxisID: 'y1',
            order: 0,
          },
          {
            type: 'bar',
            label: 'Nuevos',
            data: series.flows.nuevos,
            backgroundColor: '#10b981',
            borderRadius: 2,
            stack: 'mov',
            yAxisID: 'y',
            order: 1,
          },
          {
            type: 'bar',
            label: 'Reactivaciones',
            data: series.flows.reactivaciones,
            backgroundColor: '#a78bfa',
            borderRadius: 2,
            stack: 'mov',
            yAxisID: 'y',
            order: 1,
          },
          {
            type: 'bar',
            label: 'Renovaciones',
            data: series.flows.renovaciones,
            backgroundColor: '#4f8ef7',
            borderRadius: 2,
            stack: 'mov',
            yAxisID: 'y',
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        resizeDelay: 120,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: dated,
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { font: { size: 9 }, maxRotation: 0, autoSkipPadding: 12 },
          },
          y: {
            stacked: true,
            position: 'left',
            beginAtZero: true,
            grid: { color: '#1e2a42' },
            ticks: { font: { size: 10 } },
            title: { display: true, text: 'altas del período', font: { size: 9 } },
          },
          y1: {
            position: 'right',
            grid: { display: false },
            beginAtZero: true,
            ticks: { font: { size: 10 }, color: '#06b6d4' },
            title: { display: true, text: 'activos', color: '#06b6d4', font: { size: 9 } },
          },
        },
      },
    };
  }, [series, bucket]);

  // See TeamMovementChart: a fixed-height relative box, because an auto-height
  // parent sized by the canvas creeps down a few px on every resize tick.
  return (
    <div style={{ position: 'relative', height: CHART_HEIGHT }}>
      <ChartCanvas config={config} height={CHART_HEIGHT} />
    </div>
  );
}
