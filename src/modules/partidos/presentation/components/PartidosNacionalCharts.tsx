'use client';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';
import { ChartSkeleton } from '@/components/ui/Skeleton';
import {
  useNacionalWeekly,
  useNacionalMonthly,
  useNacionalChannels,
} from '../hooks/usePartidosData';
import { CHANNEL_COLOR } from '@partidos/core/value-objects/PartidoChannel';

const H = 260;

export function PartidosNacionalWeeklyChart() {
  const { data, isLoading } = useNacionalWeekly();
  if (isLoading || !data) return <ChartSkeleton height={H} />;
  const labels = data.map((p) => `${p.monthYear} · ${p.weekRange}`);
  return (
    <div className="chart-card">
      <div className="chart-title">Semanal</div>
      <div style={{ height: H }}>
        <LineChart
          labels={labels}
          series={[
            { label: 'Total', data: data.map((p) => p.total), color: '#06b6d4', fill: true },
            { label: 'TyC', data: data.map((p) => p.tyc), color: CHANNEL_COLOR.tyc },
            { label: 'DirectTV', data: data.map((p) => p.directTv), color: CHANNEL_COLOR.directTv },
            { label: 'BP', data: data.map((p) => p.bpEmitido), color: CHANNEL_COLOR.bpEmitido },
          ]}
          height={H}
        />
      </div>
    </div>
  );
}

export function PartidosNacionalMonthlyChart() {
  const { data, isLoading } = useNacionalMonthly();
  if (isLoading || !data) return <ChartSkeleton height={H} />;
  const labels = data.map((p) => p.monthYear);
  return (
    <div className="chart-card">
      <div className="chart-title">Mensual</div>
      <div style={{ height: H }}>
        <LineChart
          labels={labels}
          series={[
            { label: 'Total', data: data.map((p) => p.total), color: '#06b6d4', fill: true },
            { label: 'TyC', data: data.map((p) => p.tyc), color: CHANNEL_COLOR.tyc },
            { label: 'DirectTV', data: data.map((p) => p.directTv), color: CHANNEL_COLOR.directTv },
            { label: 'BP', data: data.map((p) => p.bpEmitido), color: CHANNEL_COLOR.bpEmitido },
          ]}
          height={H}
        />
      </div>
    </div>
  );
}

export function PartidosNacionalChannelBreakdown() {
  const { data, isLoading } = useNacionalChannels();
  if (isLoading || !data) return <ChartSkeleton height={H} />;
  return (
    <div className="chart-full">
      <div className="chart-title">Canales por liga</div>
      <div style={{ height: H }}>
        <BarChart
          labels={data.byLeague.map((r) => r.league)}
          values={data.byLeague.map((r) => r.total)}
          color="#06b6d4"
          height={H}
        />
      </div>
    </div>
  );
}
