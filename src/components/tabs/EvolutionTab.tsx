'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { useFilters, useFilterQS } from '@/lib/client/filterStore';
import { bucketTitles } from '@/lib/client/bucketTitle';
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard';
import { Card } from '@/components/ui/Card';
import { ACCESS, SERIES } from '@/lib/client/palette';
import { LineChart } from '@/components/charts/LineChart';
import { StackedAreaChart } from '@/components/charts/StackedAreaChart';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import type { EvolutionDTO } from '@basket/core/dtos/EvolutionDTO';

const SUB_COLORS = {
  Free: SERIES[6],
  Mensual_Basico: SERIES[0],
  Mensual_Total: SERIES[1],
  Anual_Total: SERIES[3],
};

export function EvolutionTab() {
  const granularity = useFilters((s) => s.granularity);
  const url = `/api/basket/evolution?${useFilterQS({ granularity: true })}`;
  const { data, error, isLoading } = useSWR<EvolutionDTO>(url, fetcher);

  if (isLoading) return <TabSkeleton kpis={4} blocks={[{ kind: 'full', height: 320 }, { kind: 'full', height: 300 }, { kind: 'full', height: 240 }]} />;
  if (error) return <ErrorBox message={error.message} />;
  if (!data || data.series.length === 0) {
    return <div className="card p-10 text-center text-sm text-muted">Sin datos para el rango/filtros seleccionados</div>;
  }

  const last = data.series[data.series.length - 1];
  const first = data.series[0];
  const peak = data.series.reduce((m, p) => (p.allActive > m ? p.allActive : m), 0);
  const delta = last.allActive - first.allActive;
  const deltaPct = first.allActive > 0 ? (delta / first.allActive) * 100 : 0;

  const tooltipTitles = bucketTitles(data.series.map((p) => p.bucket), granularity);
  const labels = data.series.map((p) =>
    granularity === 'month' ? p.bucket.slice(0, 7) : p.bucket.slice(5),
  );

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard
          label="Activos al final"
          value={last.allActive}
          sub={`al ${last.bucket}`}
          hint="Suscriptores con suscripción vigente en el último punto del rango (Pago exitoso más 7 días de gracia). Incluye vouchers y Antel; los datos llegan hasta ayer."
        />
        <KpiCard
          label="Pico en rango"
          value={peak}
          variant="blue"
          hint="El valor más alto de activos totales entre los puntos graficados del rango. En semana o mes cada punto ya resume varios días, así que puede diferir del pico diario."
        />
        <KpiCard
          label="Variación"
          value={`${delta >= 0 ? '+' : ''}${delta.toLocaleString()}`}
          sub={`${deltaPct.toFixed(1)}%`}
          variant={delta >= 0 ? 'green' : 'red'}
          hint="Activos totales del último punto menos los del primero, y ese cambio como porcentaje del primero. Compara los extremos del rango, no promedios."
        />
        <KpiCard
          label="Buckets"
          value={data.series.length}
          sub={granularity}
          hint="Cantidad de puntos de la serie: uno por día, semana o mes con datos dentro del rango, según la granularidad elegida arriba."
        />
      </KpiGrid>

      <Card
        title={`Activos por tipo de acceso · ${granularity}`}
        hint="Activos en cada punto según tipo de acceso: Real (pagó con dinero) y Voucher (monto cero). Antel no se dibuja pero sí suma al total indicado debajo. En semana o mes cada punto resume varios días."
      >
        <StackedAreaChart
          height={300}
          labels={labels}
          tooltipTitles={tooltipTitles}
          series={[
            { label: 'Real', data: data.series.map((p) => p.realActive), color: ACCESS.real },
            { label: 'Voucher', data: data.series.map((p) => p.voucherActive), color: ACCESS.voucher },
          ]}
        />
        <div className="mt-2 text-[11px] text-muted">
          Total activos (incluye Antel): {last.allActive.toLocaleString()}
        </div>
      </Card>

      <Card
        title="Mix por subtipo · evolución"
        hint="Activos en cada punto según plan: Free (período 0), Mensual Básico, Mensual Total y Anual Total. Los Pagos sin plan reconocible (Otros) quedan fuera, así que la suma puede no llegar al total."
      >
        <StackedAreaChart
          height={280}
          labels={labels}
          tooltipTitles={tooltipTitles}
          series={[
            { label: 'Free', data: data.series.map((p) => p.freeActive), color: SUB_COLORS.Free },
            { label: 'Mensual básico', data: data.series.map((p) => p.mensualBasicoActive), color: SUB_COLORS.Mensual_Basico },
            { label: 'Mensual total', data: data.series.map((p) => p.mensualTotalActive), color: SUB_COLORS.Mensual_Total },
            { label: 'Anual total', data: data.series.map((p) => p.anualTotalActive), color: SUB_COLORS.Anual_Total },
          ]}
        />
      </Card>

      <Card
        title="Total activos · línea"
        hint="Suscriptores con suscripción vigente en cada punto, todos los tipo de acceso y planes incluidos. Cada suscriptor cuenta una sola vez aunque tenga varios Pagos vigentes."
      >
        <LineChart
          height={220}
          labels={labels}
          tooltipTitles={tooltipTitles}
          series={[
            { label: 'Total activos', data: data.series.map((p) => p.allActive), color: SERIES[1], fill: true },
          ]}
        />
      </Card>
    </div>
  );
}

