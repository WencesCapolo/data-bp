'use client';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';
import { ChartSkeleton } from '@/components/ui/Skeleton';
import { Card } from '@/components/ui/Card';
import { SERIES } from '@/lib/client/palette';
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
    <Card title="Semanal" hint="Partidos por semana según las filas semanales de la hoja Ligas Internacionales (excluye las filas 'Total'), sumando países y ligas filtrados. Argentina y Fuera solo existen en las competiciones FIBA.">
      <LineChart
        labels={labels}
        series={[
          { label: 'Total', data: data.map((p) => p.total), color: SERIES[0], fill: true },
          { label: 'Argentina', data: data.map((p) => p.totalArg), color: SERIES[5] },
          { label: 'Fuera', data: data.map((p) => p.totalFuera), color: SERIES[3] },
          { label: 'BP Emitido', data: data.map((p) => p.bpEmitido), color: SERIES[4] },
        ]}
        height={H}
      />
    </Card>
  );
}

export function PartidosIntlMonthlyChart() {
  const { data, isLoading } = useIntlMonthly();
  if (isLoading || !data) return <ChartSkeleton height={H} />;
  const labels = data.map((p) => p.monthYear);
  return (
    <Card title="Mensual" hint="Partidos por mes según la fila 'Total' de cada mes en la hoja, sumando países y ligas filtrados. Argentina y Fuera solo existen en las competiciones FIBA; BP Emitido es lo emitido por Basquetpass.">
      <LineChart
        labels={labels}
        series={[
          { label: 'Total', data: data.map((p) => p.total), color: SERIES[0], fill: true },
          { label: 'Argentina', data: data.map((p) => p.totalArg), color: SERIES[5] },
          { label: 'Fuera', data: data.map((p) => p.totalFuera), color: SERIES[3] },
          { label: 'BP Emitido', data: data.map((p) => p.bpEmitido), color: SERIES[4] },
        ]}
        height={H}
      />
    </Card>
  );
}

export function PartidosIntlChannelBreakdown() {
  const { data, isLoading } = useIntlChannels();
  if (isLoading || !data) return <ChartSkeleton height={H} />;
  return (
    <Card title="Por país" hint="Total de partidos por país, sumando las filas 'Total' mensuales que entran en el filtro, ordenado de mayor a menor. FIBA e Internacional (Euroliga) aparecen como países propios.">
      <BarChart
        labels={data.byCountry.map((r) => r.country)}
        values={data.byCountry.map((r) => r.total)}
        color={SERIES[0]}
        height={H}
      />
    </Card>
  );
}
