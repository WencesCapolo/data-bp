'use client';
import { Chart, type ChartConfiguration } from 'chart.js';
import { useEffect, useRef } from 'react';
import { ensureChartJs } from '@/lib/client/chartjs-setup';
import { useChartTheme } from '@/lib/client/theme';

interface Props {
  config: ChartConfiguration;
  height?: number;
}

export function ChartCanvas({ config, height = 220 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const instance = useRef<Chart | null>(null);
  const chartTheme = useChartTheme();

  useEffect(() => {
    ensureChartJs();
    if (!ref.current) return;
    // El color de leyendas y ejes es global en Chart.js, así que se fija aquí,
    // en el único sitio por el que pasan todos los gráficos, y no en el setup
    // que corre una sola vez.
    Chart.defaults.color = chartTheme.tick;
    instance.current?.destroy();
    instance.current = new Chart(ref.current, config);
    return () => {
      instance.current?.destroy();
      instance.current = null;
    };
  }, [config, chartTheme]);

  // Fixed-height relative box, and the canvas carries no height of its own.
  //
  // Every chart here runs `maintainAspectRatio: false`, which makes Chart.js size
  // the canvas from its *parent*. Passing `height` as a canvas attribute sets the
  // bitmap size, not the CSS box — so the parent stayed auto-height, took its
  // height from the canvas, and Chart.js then re-read that taller parent on the
  // next resize tick. Each pass added a few pixels and the chart crept down the
  // page forever.
  //
  // The parent has to be the thing that owns the height, and the canvas has to be
  // free to fill it. That is also why the box is `position: relative` — it is what
  // Chart.js's own responsive guidance asks for.
  return (
    <div style={{ position: 'relative', height, width: '100%' }}>
      <canvas ref={ref} />
    </div>
  );
}
