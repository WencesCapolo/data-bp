'use client';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';
import { ChartSkeleton } from '@/components/ui/Skeleton';
import { InfoHint } from '@/components/ui/InfoHint';
import {
  useIntlWeekly,
  useIntlMonthly,
  useIntlChannels,
} from '../hooks/usePartidosData';

const H = 260;

export function PartidosIntlWeeklyChart() {
  const { data, isLoading } = useIntlWeekly();
  if (isLoading || !data) return <ChartSkeleton height={H} />;
  const labels = data.map((p) => `${p.monthYear} · ${p.weekRange}`);
  return (
    <div className="chart-card">
      <div className="chart-title">
        Semanal
        <InfoHint text="Partidos por semana según las filas semanales de la hoja Ligas Internacionales (excluye las filas 'Total'), sumando países y ligas filtrados. Argentina y Fuera solo existen en las competiciones FIBA." />
      </div>
      <div style={{ height: H }}>
        <LineChart
          labels={labels}
          series={[
            { label: 'Total', data: data.map((p) => p.total), color: '#06b6d4', fill: true },
            { label: 'Argentina', data: data.map((p) => p.totalArg), color: '#f59e0b' },
            { label: 'Fuera', data: data.map((p) => p.totalFuera), color: '#a78bfa' },
            { label: 'BP Emitido', data: data.map((p) => p.bpEmitido), color: '#22c55e' },
          ]}
          height={H}
        />
      </div>
    </div>
  );
}

export function PartidosIntlMonthlyChart() {
  const { data, isLoading } = useIntlMonthly();
  if (isLoading || !data) return <ChartSkeleton height={H} />;
  const labels = data.map((p) => p.monthYear);
  return (
    <div className="chart-card">
      <div className="chart-title">
        Mensual
        <InfoHint text="Partidos por mes según la fila 'Total' de cada mes en la hoja, sumando países y ligas filtrados. Argentina y Fuera solo existen en las competiciones FIBA; BP Emitido es lo emitido por Basquetpass." />
      </div>
      <div style={{ height: H }}>
        <LineChart
          labels={labels}
          series={[
            { label: 'Total', data: data.map((p) => p.total), color: '#06b6d4', fill: true },
            { label: 'Argentina', data: data.map((p) => p.totalArg), color: '#f59e0b' },
            { label: 'Fuera', data: data.map((p) => p.totalFuera), color: '#a78bfa' },
            { label: 'BP Emitido', data: data.map((p) => p.bpEmitido), color: '#22c55e' },
          ]}
          height={H}
        />
      </div>
    </div>
  );
}

export function PartidosIntlChannelBreakdown() {
  const { data, isLoading } = useIntlChannels();
  if (isLoading || !data) return <ChartSkeleton height={H} />;
  return (
    <div className="chart-full">
      <div className="chart-title">
        Por país
        <InfoHint text="Total de partidos por país, sumando las filas 'Total' mensuales que entran en el filtro, ordenado de mayor a menor. FIBA e Internacional (Euroliga) aparecen como países propios." />
      </div>
      <div style={{ height: H }}>
        <BarChart
          labels={data.byCountry.map((r) => r.country)}
          values={data.byCountry.map((r) => r.total)}
          color="#06b6d4"
          height={H}
        />
      </div>
    </div>
  );
}
