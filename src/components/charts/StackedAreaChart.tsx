'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from './ChartCanvas';
import { tooltipOpts } from './tooltip';

interface Series {
  label: string;
  data: number[];
  color: string;
}

interface Props {
  labels: string[];
  series: Series[];
  height?: number;
  tooltipTitles?: string[];
}

function hexAlpha(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function fmt(n: number): string {
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

export function StackedAreaChart({ labels, series, height = 260, tooltipTitles }: Props) {
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'line',
      data: {
        labels,
        datasets: series.map((s) => ({
          label: s.label,
          data: s.data,
          borderColor: s.color,
          backgroundColor: hexAlpha(s.color, 0.35),
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 1.5,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: tooltipOpts(tooltipTitles),
        },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { color: '#1e2a42' }, stacked: true },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: '#1e2a42' },
            ticks: { callback: (v) => fmt(v as number) },
          },
        },
      },
    }),
    [labels, series, tooltipTitles],
  );
  return <ChartCanvas config={config} height={height} />;
}
