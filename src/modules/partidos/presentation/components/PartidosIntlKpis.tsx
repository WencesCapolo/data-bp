'use client';
import { KpiCard } from '@/components/ui/KpiCard';
import { KpiGridSkeleton } from '@/components/ui/Skeleton';
import { useIntlOverview } from '../hooks/usePartidosData';

export function PartidosIntlKpis() {
  const { data, isLoading } = useIntlOverview();
  if (isLoading || !data) return <KpiGridSkeleton count={6} />;
  return (
    <div className="kpi-grid">
      <KpiCard
        label="Total temporada"
        value={data.totalSeason}
        hint="Partidos sumados de las filas 'Total' de cada mes de la hoja Ligas Internacionales, con los filtros aplicados. Sin filtro de temporada, suma todas las temporadas cargadas."
      />
      <KpiCard
        label="Último mes"
        value={data.totalMonth}
        sub={data.lastMonthLabel ?? undefined}
        hint="Partidos de la fila 'Total' del último mes que entra en el filtro, sumando los países y ligas seleccionados."
      />
      <KpiCard
        label="Total Argentina"
        value={data.totalArg}
        variant="blue"
        hint="Suma de la columna 'Argentina' de las filas 'Total' mensuales. Solo las competiciones FIBA (BCLA, LSB, WBLA, Interligas) tienen esa columna; el resto aporta cero."
      />
      <KpiCard
        label="Total fuera"
        value={data.totalFuera}
        variant="yellow"
        hint="Suma de la columna 'Fuera' de las filas 'Total' mensuales. Igual que Argentina, existe solo en las competiciones FIBA; los demás países aportan cero."
      />
      <KpiCard
        label="BP Emitido"
        value={data.bpEmitido}
        variant="green"
        hint="Partidos emitidos por Basquetpass: suma de la columna 'BP Emitido' de las filas 'Total' mensuales, en las ligas y países filtrados."
      />
      <KpiCard
        label="BP Producido"
        value={data.bpProducido}
        variant="green"
        hint="Partidos producidos por Basquetpass. Suma la columna 'BP Producido' más las columnas propias de cada liga que cuentan como producción BP (sin TV, offtube, envíos de señal, Sportian, Synergy)."
      />
      <KpiCard
        label="Externo Producido"
        value={data.externoProducido}
        hint="Partidos producidos por terceros. Suma la columna 'Externo Producido' más las columnas de cada liga que cuentan como producción externa (TV Uruguay, señal completa, ATM, CDO, TVN)."
      />
    </div>
  );
}
