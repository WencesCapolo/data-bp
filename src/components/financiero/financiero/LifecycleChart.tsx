'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '@/components/charts/ChartCanvas';
import { useChartTheme } from '@/lib/client/theme';
import { tooltipBase } from '@/components/charts/tooltip';
import { fmt } from '@/components/financiero/contenido/format';

/**
 * Bars above and below zero with lines over them, all on ONE axis.
 *
 * This is the prototype's lifecycle shape: altas stacked upwards, bajas drawn
 * downwards, and the net as a line that crosses zero — which only reads if the
 * three share a scale. ComboChart puts its lines on a second axis, because its
 * pairs differ by orders of magnitude; here they are the same unit, and a
 * second axis would let a line of 50 tower over a bar of 500.
 *
 * A bar's `stack` decides what it piles onto: the prototype stacks the two
 * kinds of alta into one column and keeps bajas in their own, negative one.
 * Tooltips print absolute values, since the sign is only a drawing choice.
 */
export interface LifecycleBar {
  label: string;
  data: number[];
  color: string;
  stack?: string;
  /** Start hidden, toggled on from the legend — for a series that is tiny next
   *  to the others and would only clutter the default view. */
  hidden?: boolean;
}

export interface LifecycleLine {
  label: string;
  data: number[];
  color: string;
  dashed?: boolean;
}

export function LifecycleChart({
  labels,
  bars,
  lines = [],
  height = 320,
  tooltipTitles,
  yMin,
  yMax,
  legend = true,
}: {
  labels: string[];
  bars: LifecycleBar[];
  lines?: LifecycleLine[];
  height?: number;
  tooltipTitles?: string[];
  /** Pin the axis instead of starting at zero: a pool of 24,000 that moves by
   *  60 a day is a flat line from zero, and the movement is the point. */
  yMin?: number;
  yMax?: number;
  legend?: boolean;
}) {
  const chartTheme = useChartTheme();
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          ...bars.map((b) => ({
            type: 'bar' as const,
            label: b.label,
            data: b.data,
            backgroundColor: b.color,
            borderRadius: 3,
            maxBarThickness: 36,
            stack: b.stack ?? 'a',
            hidden: b.hidden ?? false,
            order: 3,
          })),
          ...lines.map((l, i) => ({
            type: 'line' as const,
            label: l.label,
            data: l.data,
            borderColor: l.color,
            backgroundColor: `${l.color}22`,
            borderDash: l.dashed ? [5, 4] : undefined,
            tension: 0.3,
            borderWidth: 2.5,
            pointRadius: labels.length <= 31 ? 3 : 0,
            pointHoverRadius: 6,
            pointBackgroundColor: l.color,
            fill: false,
            order: i + 1,
          })),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: legend, position: 'bottom', labels: { boxWidth: 10, padding: 12, usePointStyle: true } },
          tooltip: {
            ...tooltipBase(chartTheme),
            callbacks: {
              title: (items) =>
                tooltipTitles?.[items[0]?.dataIndex ?? -1] ?? String(items[0]?.label ?? ''),
              label: (ctx) => `${ctx.dataset.label}: ${fmt(Math.abs(Number(ctx.parsed.y)))}`,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: labels.length > 31, maxTicksLimit: 16 },
          },
          y: {
            stacked: true,
            min: yMin,
            max: yMax,
            beginAtZero: yMin === undefined,
            grid: { color: chartTheme.grid },
            ticks: { font: { size: 10 }, callback: (v) => fmt(Math.abs(Number(v))) },
          },
        },
      },
    }),
    [labels, bars, lines, tooltipTitles, chartTheme, yMin, yMax, legend],
  );
  return <ChartCanvas config={config} height={height} />;
}
