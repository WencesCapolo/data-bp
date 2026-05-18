'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from './ChartCanvas';

interface Props {
  labels: string[];
  values: number[];
  color?: string;
  height?: number;
  horizontal?: boolean;
}

export function BarChart({ labels, values, color = '#06b6d4', height = 220, horizontal = false }: Props) {
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: '', data: values, backgroundColor: color, borderRadius: 4 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: horizontal ? 'y' : 'x',
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: '#0f1525', borderColor: '#2a3752', borderWidth: 1, padding: 10 },
        },
        scales: {
          x: { grid: { color: '#1e2a42' }, ticks: { font: { size: 10 } } },
          y: { grid: { color: '#1e2a42' }, ticks: { font: { size: 10 } }, beginAtZero: true },
        },
      },
    }),
    [labels, values, color, horizontal],
  );
  return <ChartCanvas config={config} height={height} />;
}
