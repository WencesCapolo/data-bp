'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from './ChartCanvas';
import { useChartTheme } from '@/lib/client/theme';
import { tooltipOpts } from './tooltip';

interface Props {
  labels: string[];
  /** `null` is a gap, not a zero: Chart.js leaves the line broken there, which
   *  is what a month with no exchange rate has to look like. */
  series: {
    label: string;
    data: (number | null)[];
    color?: string;
    fill?: boolean;
    /** `right` draws the series against a second y-axis on the right. For a
     *  series an order of magnitude below the others, sharing one axis pins
     *  it flat to the floor and stretches the scale for everyone else. */
    axis?: 'left' | 'right';
  }[];
  height?: number;
  yFormat?: 'number' | 'currency';
  tooltipTitles?: string[];
}

export function LineChart({ labels, series, height = 220, yFormat = 'number', tooltipTitles }: Props) {
  const chartTheme = useChartTheme();
  const hasRight = series.some((s) => s.axis === 'right');
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'line',
      data: {
        labels,
        datasets: series.map((s) => ({
          label: s.label,
          data: s.data,
          borderColor: s.color ?? '#06b6d4',
          backgroundColor: s.fill ? hexAlpha(s.color ?? '#06b6d4', 0.12) : 'transparent',
          fill: s.fill ?? false,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
          yAxisID: s.axis === 'right' ? 'y1' : 'y',
          ...(s.axis === 'right' ? { borderDash: [4, 3] } : {}),
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: series.length > 1, labels: { boxWidth: 10 } },
          tooltip: tooltipOpts(tooltipTitles, chartTheme),
        },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { color: chartTheme.grid } },
          y: {
            beginAtZero: false,
            grid: { color: chartTheme.grid },
            ticks: {
              callback: (v) => (yFormat === 'currency' ? `$${fmt(v as number)}` : fmt(v as number)),
            },
          },
          ...(hasRight
            ? {
                y1: {
                  position: 'right' as const,
                  beginAtZero: false,
                  grid: { drawOnChartArea: false },
                  ticks: {
                    callback: (v: string | number) =>
                      yFormat === 'currency' ? `$${fmt(v as number)}` : fmt(v as number),
                  },
                },
              }
            : {}),
        },
      },
    }),
    [labels, series, yFormat, tooltipTitles, chartTheme, hasRight],
  );
  return <ChartCanvas config={config} height={height} />;
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
function hexAlpha(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
