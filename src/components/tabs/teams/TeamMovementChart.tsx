'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '@/components/charts/ChartCanvas';
import type { Bucket, BucketedSeries } from './buckets';
import { bucketTitles } from '@/lib/client/bucketTitle';
import { tooltipOpts } from '@/components/charts/tooltip';
import { CHART_THEME, SERIES, TREND } from '@/lib/client/palette';

const CHART_HEIGHT = 280;

// Bars = altas (up) / bajas (down); line = active subscriptions at the close of
// the period, on its own axis, so the movement is read against the base it moves.
export function TeamMovementChart({ series, bucket }: { series: BucketedSeries; bucket: Bucket }) {
  const config = useMemo<ChartConfiguration>(() => {
    const dated = tooltipOpts(bucketTitles(series.keys, bucket));
    return {
      type: 'bar',
      data: {
        labels: series.labels,
        datasets: [
          {
            type: 'line',
            label: 'Suscripciones activas',
            data: series.active,
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
            label: 'Altas',
            data: series.altas,
            backgroundColor: TREND.up,
            borderRadius: 2,
            stack: 'mov',
            yAxisID: 'y',
            order: 1,
          },
          {
            type: 'bar',
            label: 'Bajas',
            data: series.bajas.map((b) => -b),
            backgroundColor: TREND.down,
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
          tooltip: {
            ...dated,
            callbacks: {
              ...dated.callbacks,
              label: (ctx) =>
                `${ctx.dataset.label}: ${Math.abs(Number(ctx.parsed.y)).toLocaleString()}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 9 }, maxRotation: 0, autoSkipPadding: 12 },
          },
          y: {
            position: 'left',
            grid: { color: CHART_THEME.grid },
            ticks: { font: { size: 10 }, callback: (v) => Math.abs(Number(v)) },
            title: { display: true, text: 'altas / bajas', font: { size: 9 } },
          },
          y1: {
            position: 'right',
            grid: { display: false },
            beginAtZero: true,
            ticks: { font: { size: 10 }, color: SERIES[1] },
            title: { display: true, text: 'activas', color: SERIES[1], font: { size: 9 } },
          },
        },
      },
    };
  }, [series, bucket]);

  // The fixed-height relative box this used to wrap by hand now lives inside
  // ChartCanvas, so every chart gets it rather than only this one.
  return <ChartCanvas config={config} height={CHART_HEIGHT} />;
}
