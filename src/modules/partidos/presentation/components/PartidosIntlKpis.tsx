'use client';
import { KpiCard } from '@/components/ui/KpiCard';
import { KpiGridSkeleton } from '@/components/ui/Skeleton';
import { useIntlOverview } from '../hooks/usePartidosData';

export function PartidosIntlKpis() {
  const { data, isLoading } = useIntlOverview();
  if (isLoading || !data) return <KpiGridSkeleton count={6} />;
  return (
    <div className="kpi-grid">
      <KpiCard label="Total temporada" value={data.totalSeason} />
      <KpiCard
        label="Último mes"
        value={data.totalMonth}
        sub={data.lastMonthLabel ?? undefined}
      />
      <KpiCard label="Total Argentina" value={data.totalArg} variant="blue" />
      <KpiCard label="Total fuera" value={data.totalFuera} variant="yellow" />
      <KpiCard label="BP Emitido" value={data.bpEmitido} variant="green" />
      <KpiCard label="BP Producido" value={data.bpProducido} variant="green" />
      <KpiCard label="Externo Producido" value={data.externoProducido} />
    </div>
  );
}
