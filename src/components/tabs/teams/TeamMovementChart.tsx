'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '@/components/charts/ChartCanvas';
import type { Bucket, BucketedSeries } from './buckets';
import { bucketTitles } from '@/lib/client/bucketTitle';
import { tooltipOpts } from '@/components/charts/tooltip';

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
            label: 'Altas',
            data: series.altas,
            backgroundColor: '#10b981',
            borderRadius: 2,
            stack: 'mov',
            yAxisID: 'y',
            order: 1,
          },
          {
            type: 'bar',
            label: 'Bajas',
            data: series.bajas.map((b) => -b),
            backgroundColor: '#ef4444',
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
            grid: { color: '#1e2a42' },
            ticks: { font: { size: 10 }, callback: (v) => Math.abs(Number(v)) },
            title: { display: true, text: 'altas / bajas', font: { size: 9 } },
          },
          y1: {
            position: 'right',
            grid: { display: false },
            beginAtZero: true,
            ticks: { font: { size: 10 }, color: '#06b6d4' },
            title: { display: true, text: 'activas', color: '#06b6d4', font: { size: 9 } },
          },
        },
      },
    };
  }, [series, bucket]);

  // Fixed-height relative box: Chart.js with maintainAspectRatio:false sizes the
  // canvas from its parent, and an auto-height parent sized by the canvas grows a
  // few px on every resize tick — the chart (and the table under it) creep down.
  return (
    <div style={{ position: 'relative', height: CHART_HEIGHT }}>
      <ChartCanvas config={config} height={CHART_HEIGHT} />
    </div>
  );
}
