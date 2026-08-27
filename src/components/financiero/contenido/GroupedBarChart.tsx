'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '@/components/charts/ChartCanvas';
import { useChartTheme } from '@/lib/client/theme';
import { tooltipBase } from '@/components/charts/tooltip';
import { fmt } from './format';

/**
 * Horizontal grouped bars: views beside unique users, one pair per row.
 *
 * Grouped rather than stacked. A user is not a subset of a view that can be
 * added to it — stacking the two would draw a bar whose length means nothing.
 */
export function GroupedBarChart({
  labels,
  series,
  height = 320,
}: {
  labels: string[];
  series: { label: string; data: number[]; color: string }[];
  height?: number;
}) {
  const chartTheme = useChartTheme();
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: series.map((s) => ({
          label: s.label,
          data: s.data,
          backgroundColor: s.color,
          borderRadius: 3,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, usePointStyle: true } },
          tooltip: {
            ...tooltipBase(chartTheme),
            callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(Number(ctx.parsed.x))}` },
          },
        },
        scales: {
          x: { grid: { color: chartTheme.grid }, ticks: { font: { size: 10 }, callback: (v) => fmt(Number(v)) } },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } },
        },
      },
    }),
    [labels, series, chartTheme],
  );
  return <ChartCanvas config={config} height={height} />;
}
