'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from './ChartCanvas';
import { useChartTheme } from '@/lib/client/theme';
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

function fmt(n: number): string {
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

export function StackedBarChart({ labels, series, height = 260, tooltipTitles }: Props) {
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
          borderRadius: 2,
          stack: 'a',
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: tooltipOpts(tooltipTitles, chartTheme),
        },
        scales: {
          x: { stacked: true, grid: { color: chartTheme.grid }, ticks: { font: { size: 10 }, autoSkip: true, maxTicksLimit: 14 } },
          y: { stacked: true, grid: { color: chartTheme.grid }, ticks: { callback: (v) => fmt(v as number) }, beginAtZero: true },
        },
      },
    }),
    [labels, series, tooltipTitles, chartTheme],
  );
  return <ChartCanvas config={config} height={height} />;
}
