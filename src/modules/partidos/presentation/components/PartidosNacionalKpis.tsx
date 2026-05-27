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
      <KpiCard label="Total temporada" value={data.totalSeason} />
      <KpiCard
        label="Último mes"
        value={data.totalMonth}
        sub={data.lastMonthLabel ?? undefined}
        delta={delta(data.deltaMonth)}
      />
      <KpiCard
        label="Última semana"
        value={data.totalWeek}
        sub={data.lastWeekLabel ?? undefined}
        delta={delta(data.deltaWeek)}
      />
      <KpiCard label="Promedio semanal" value={data.avgWeek} variant="blue" />
    </div>
  );
}
