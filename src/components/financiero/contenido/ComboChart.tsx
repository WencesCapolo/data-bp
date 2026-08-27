'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '@/components/charts/ChartCanvas';
import { useChartTheme } from '@/lib/client/theme';
import { tooltipBase } from '@/components/charts/tooltip';
import { fmt } from './format';

/**
 * Bars on a left axis, lines on a right one.
 *
 * Two axes because the pairs plotted here differ by three orders of magnitude —
 * half a million views against a few hundred published pieces. On one axis the
 * smaller series is a flat line on the floor, which reads as "no content
 * published" rather than as a scale problem.
 */
export interface ComboSeries {
  label: string;
  data: number[];
  color: string;
  dashed?: boolean;
}

export function ComboChart({
  labels,
  bars,
  lines,
  barAxisTitle,
  lineAxisTitle,
  height = 320,
  tooltipTitles,
}: {
  labels: string[];
  bars: ComboSeries[];
  lines: ComboSeries[];
  barAxisTitle: string;
  lineAxisTitle: string;
  height?: number;
  tooltipTitles?: string[];
}) {
  const chartTheme = useChartTheme();
  const config = useMemo<ChartConfiguration>(
    () => ({
      // Declared as a bar chart carrying line datasets, which is how Chart.js
      // types a mixed chart: the per-dataset `type` overrides this one.
      type: 'bar',
      data: {
        labels,
        datasets: [
          ...bars.map((b) => ({
            type: 'bar' as const,
            label: b.label,
            data: b.data,
            backgroundColor: `${b.color}8c`,
            borderColor: b.color,
            borderWidth: 1,
            borderRadius: 3,
            yAxisID: 'yBar',
            order: 3,
          })),
          ...lines.map((l, i) => ({
            type: 'line' as const,
            label: l.label,
            data: l.data,
            borderColor: l.color,
            backgroundColor: 'transparent',
            borderDash: l.dashed ? [5, 3] : undefined,
            tension: 0.3,
            borderWidth: 2.2,
            pointRadius: 0,
            yAxisID: 'yLine',
            order: i + 1,
          })),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, usePointStyle: true } },
          tooltip: {
            ...tooltipBase(chartTheme),
            callbacks: {
              title: (items) =>
                tooltipTitles?.[items[0]?.dataIndex ?? -1] ?? String(items[0]?.label ?? ''),
              label: (ctx) => `${ctx.dataset.label}: ${fmt(Number(ctx.parsed.y))}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } },
          yBar: {
            position: 'left',
            grid: { color: chartTheme.grid },
            ticks: { font: { size: 10 }, callback: (v) => fmt(Number(v)) },
            title: { display: true, text: barAxisTitle, color: bars[0]?.color, font: { size: 10 } },
          },
          yLine: {
            position: 'right',
            grid: { display: false },
            ticks: { font: { size: 10 }, callback: (v) => fmt(Number(v)) },
            title: { display: true, text: lineAxisTitle, color: lines[0]?.color, font: { size: 10 } },
          },
        },
      },
    }),
    [labels, bars, lines, barAxisTitle, lineAxisTitle, tooltipTitles, chartTheme],
  );
  return <ChartCanvas config={config} height={height} />;
}
