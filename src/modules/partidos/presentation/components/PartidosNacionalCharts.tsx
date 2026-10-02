'use client';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';
import { ChartSkeleton } from '@/components/ui/Skeleton';
import { Card } from '@/components/ui/Card';
import { SERIES } from '@/lib/client/palette';
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
    <Card title="Semanal" hint="Partidos por semana según las filas semanales de la hoja Ligas Argentinas (excluye las filas 'Total'), sumando las ligas filtradas. TyC y DirectTV solo se cargan para la LNB; BP es lo emitido por Basquetpass.">
      <LineChart
        labels={labels}
        series={[
          { label: 'Total', data: data.map((p) => p.total), color: SERIES[0], fill: true },
          { label: 'TyC', data: data.map((p) => p.tyc), color: CHANNEL_COLOR.tyc },
          { label: 'DirectTV', data: data.map((p) => p.directTv), color: CHANNEL_COLOR.directTv },
          { label: 'BP', data: data.map((p) => p.bpEmitido), color: CHANNEL_COLOR.bpEmitido },
        ]}
        height={H}
      />
    </Card>
  );
}

export function PartidosNacionalMonthlyChart() {
  const { data, isLoading } = useNacionalMonthly();
  if (isLoading || !data) return <ChartSkeleton height={H} />;
  const labels = data.map((p) => p.monthYear);
  return (
    <Card title="Mensual" hint="Partidos por mes según la fila 'Total' de cada mes en la hoja, sumando las ligas filtradas. TyC y DirectTV solo se cargan para la LNB; BP es lo emitido por Basquetpass.">
      <LineChart
        labels={labels}
        series={[
          { label: 'Total', data: data.map((p) => p.total), color: SERIES[0], fill: true },
          { label: 'TyC', data: data.map((p) => p.tyc), color: CHANNEL_COLOR.tyc },
          { label: 'DirectTV', data: data.map((p) => p.directTv), color: CHANNEL_COLOR.directTv },
          { label: 'BP', data: data.map((p) => p.bpEmitido), color: CHANNEL_COLOR.bpEmitido },
        ]}
        height={H}
      />
    </Card>
  );
}

export function PartidosNacionalChannelBreakdown() {
  const { data, isLoading } = useNacionalChannels();
  if (isLoading || !data) return <ChartSkeleton height={H} />;
  return (
    <Card title="Canales por liga" hint="Total de partidos por liga, sumando las filas 'Total' mensuales que entran en el filtro, ordenado de mayor a menor. Muestra el total de cada liga, no el desglose por canal.">
      <BarChart
        labels={data.byLeague.map((r) => r.league)}
        values={data.byLeague.map((r) => r.total)}
        color={SERIES[0]}
        height={H}
      />
    </Card>
  );
}
