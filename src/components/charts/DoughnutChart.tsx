'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from './ChartCanvas';
import { CHART_THEME, SERIES } from '@/lib/client/palette';
import { tooltipBase } from './tooltip';

interface Props {
  labels: string[];
  values: number[];
  colors?: string[];
  height?: number;
}

export function DoughnutChart({ labels, values, colors, height = 220 }: Props) {
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors ?? SERIES.slice(0, labels.length),
            borderColor: CHART_THEME.surface,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: {
            ...tooltipBase(CHART_THEME),
            callbacks: {
              label: (ctx) => {
                const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0);
                const v = ctx.parsed as number;
                const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
                return ` ${ctx.label}: ${v.toLocaleString()} (${pct}%)`;
              },
            },
          },
        },
      },
    }),
    [labels, values, colors],
  );
  return <ChartCanvas config={config} height={height} />;
}
