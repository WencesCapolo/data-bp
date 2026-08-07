'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from './ChartCanvas';
import { tooltipOpts } from './tooltip';

interface Props {
  labels: string[];
  values: number[];
  color?: string;
  height?: number;
  horizontal?: boolean;
  tooltipTitles?: string[];
}

export function BarChart({
  labels,
  values,
  color = '#06b6d4',
  height = 220,
  horizontal = false,
  tooltipTitles,
}: Props) {
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
          tooltip: tooltipOpts(tooltipTitles),
        },
        scales: {
          x: { grid: { color: '#1e2a42' }, ticks: { font: { size: 10 } } },
          y: { grid: { color: '#1e2a42' }, ticks: { font: { size: 10 } }, beginAtZero: true },
        },
      },
    }),
    [labels, values, color, horizontal, tooltipTitles],
  );
  return <ChartCanvas config={config} height={height} />;
}
