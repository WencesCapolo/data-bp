'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from './ChartCanvas';
import { CHART_THEME, SERIES } from '@/lib/client/palette';
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
  color = SERIES[1],
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
          tooltip: tooltipOpts(tooltipTitles, CHART_THEME),
        },
        scales: {
          x: { grid: { color: CHART_THEME.grid }, ticks: { font: { size: 10 } } },
          y: { grid: { color: CHART_THEME.grid }, ticks: { font: { size: 10 } }, beginAtZero: true },
        },
      },
    }),
    [labels, values, color, horizontal, tooltipTitles],
  );
  return <ChartCanvas config={config} height={height} />;
}
