'use client';
import { Chart, type ChartConfiguration } from 'chart.js';
import { useEffect, useRef } from 'react';
import { ensureChartJs } from '@/lib/client/chartjs-setup';

interface Props {
  config: ChartConfiguration;
  height?: number;
}

export function ChartCanvas({ config, height = 220 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const instance = useRef<Chart | null>(null);

  useEffect(() => {
    ensureChartJs();
    if (!ref.current) return;
    instance.current?.destroy();
    instance.current = new Chart(ref.current, config);
    return () => {
      instance.current?.destroy();
      instance.current = null;
    };
  }, [config]);

  return <canvas ref={ref} height={height} />;
}
