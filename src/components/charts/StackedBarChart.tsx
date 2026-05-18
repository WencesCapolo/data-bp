'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from './ChartCanvas';

interface Series {
  label: string;
  data: number[];
  color: string;
}

interface Props {
  labels: string[];
  series: Series[];
  height?: number;
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

export function StackedBarChart({ labels, series, height = 260 }: Props) {
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: series.map((s) => ({
          label: s.label,
          data: s.data,
          backgroundColor: s.color,
          borderRadius: 2,
          stack: 'a',
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { backgroundColor: '#0f1525', borderColor: '#2a3752', borderWidth: 1, padding: 10 },
        },
        scales: {
          x: { stacked: true, grid: { color: '#1e2a42' }, ticks: { font: { size: 10 }, autoSkip: true, maxTicksLimit: 14 } },
          y: { stacked: true, grid: { color: '#1e2a42' }, ticks: { callback: (v) => fmt(v as number) }, beginAtZero: true },
        },
      },
    }),
    [labels, series],
  );
  return <ChartCanvas config={config} height={height} />;
}
