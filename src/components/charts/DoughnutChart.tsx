'use client';
import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from './ChartCanvas';

interface Props {
  labels: string[];
  values: number[];
  colors?: string[];
  height?: number;
}

const DEFAULT_COLORS = ['#4f8ef7', '#22d3ee', '#f43f5e', '#a78bfa', '#34d399', '#fb923c', '#94a3b8', '#e30613'];

export function DoughnutChart({ labels, values, colors, height = 220 }: Props) {
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors ?? DEFAULT_COLORS.slice(0, labels.length),
            borderColor: '#0f1525',
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
            backgroundColor: '#0f1525',
            borderColor: '#2a3752',
            borderWidth: 1,
            padding: 10,
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
