'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '@/components/charts/ChartCanvas';
import { bucketTitles } from '@/lib/client/bucketTitle';
import { tooltipOpts } from '@/components/charts/tooltip';
import { CHART_THEME, SERIES, TREND } from '@/lib/client/palette';
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
            borderColor: SERIES[1],
            backgroundColor: 'rgba(8,145,178,.12)',
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
            backgroundColor: TREND.up,
            borderRadius: 2,
            stack: 'mov',
            yAxisID: 'y',
            order: 1,
          },
          {
            type: 'bar',
            label: 'Reactivaciones',
            data: series.flows.reactivaciones,
            backgroundColor: SERIES[3],
            borderRadius: 2,
            stack: 'mov',
            yAxisID: 'y',
            order: 1,
          },
          {
            type: 'bar',
            label: 'Renovaciones',
            data: series.flows.renovaciones,
            backgroundColor: SERIES[0],
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
            grid: { color: CHART_THEME.grid },
            ticks: { font: { size: 10 } },
            title: { display: true, text: 'altas del período', font: { size: 9 } },
          },
          y1: {
            position: 'right',
            grid: { display: false },
            beginAtZero: true,
            ticks: { font: { size: 10 }, color: SERIES[1] },
            title: { display: true, text: 'activos', color: SERIES[1], font: { size: 9 } },
          },
        },
      },
    };
  }, [series, bucket]);

  // ChartCanvas owns the fixed-height relative box: an auto-height parent sized
  // by the canvas creeps down a few px on every resize tick.
  return <ChartCanvas config={config} height={CHART_HEIGHT} />;
}
