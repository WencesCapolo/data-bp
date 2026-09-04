'use client';
import { KpiCard } from '@/components/ui/KpiCard';
import { KpiGridSkeleton } from '@/components/ui/Skeleton';
import { useNacionalOverview } from '../hooks/usePartidosData';

function delta(n: number | null): { value: string; up: boolean } | undefined {
  if (n == null) return undefined;
  return { value: String(Math.abs(n)), up: n >= 0 };
}

export function PartidosNacionalKpis() {
  const { data, isLoading } = useNacionalOverview();
  if (isLoading || !data) {
    return <KpiGridSkeleton count={4} />;
  }
  return (
    <div className="kpi-grid">
      <KpiCard
        label="Total temporada"
        value={data.totalSeason}
        hint="Partidos sumados de las filas 'Total' de cada mes de la hoja Ligas Argentinas, con los filtros aplicados. Sin filtro de temporada, suma todas las temporadas cargadas."
      />
      <KpiCard
        label="Último mes"
        value={data.totalMonth}
        sub={data.lastMonthLabel ?? undefined}
        delta={delta(data.deltaMonth)}
        hint="Partidos de la fila 'Total' del último mes que entra en el filtro. La flecha compara contra el mes anterior en partidos, no en porcentaje."
      />
      <KpiCard
        label="Última semana"
        value={data.totalWeek}
        sub={data.lastWeekLabel ?? undefined}
        delta={delta(data.deltaWeek)}
        hint="Partidos de la última fila semanal de la hoja (excluye las filas 'Total' del mes), sumando las ligas filtradas. La flecha compara contra la semana anterior."
      />
      <KpiCard
        label="Promedio semanal"
        value={data.avgWeek}
        variant="blue"
        hint="Promedio simple de partidos por semana sobre todas las filas semanales que entran en el filtro, redondeado a un decimal. Las semanas sin fila no cuentan como cero."
      />
    </div>
  );
}
