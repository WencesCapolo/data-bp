'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { useFilters } from '@/lib/client/filterStore';
import { KpiCard } from '@/components/ui/KpiCard';
import { LineChart } from '@/components/charts/LineChart';
import { StackedAreaChart } from '@/components/charts/StackedAreaChart';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import type { EvolutionDTO } from '@basket/core/dtos/EvolutionDTO';

const ACCESS_COLORS = { real: '#10b981', voucher: '#fbbf24' };
const SUB_COLORS = {
  Free: '#94a3b8',
  Mensual_Basico: '#4f8ef7',
  Mensual_Total: '#22d3ee',
  Anual_Total: '#a78bfa',
};

function buildUrl(s: {
  range: string;
  granularity: string;
  countries: string[];
  accessType?: string;
  subType?: string;
}): string {
  const p = new URLSearchParams();
  p.set('range', s.range);
  p.set('granularity', s.granularity);
  for (const c of s.countries) p.append('countries', c);
  if (s.accessType) p.set('accessType', s.accessType);
  if (s.subType) p.set('subType', s.subType);
  return `/api/basket/evolution?${p.toString()}`;
}

export function EvolutionTab() {
  const range = useFilters((s) => s.range);
  const granularity = useFilters((s) => s.granularity);
  const countries = useFilters((s) => s.countries);
  const accessType = useFilters((s) => s.accessType);
  const subType = useFilters((s) => s.subType);

  const url = buildUrl({ range, granularity, countries, accessType, subType });
  const { data, error, isLoading } = useSWR<EvolutionDTO>(url, fetcher);

  if (isLoading) return <TabSkeleton kpis={4} blocks={[{ kind: 'full', height: 320 }, { kind: 'full', height: 300 }, { kind: 'full', height: 240 }]} />;
  if (error) return <ErrorBox message={error.message} />;
  if (!data || data.series.length === 0) {
    return <div className="no-data">Sin datos para el rango/filtros seleccionados</div>;
  }

  const last = data.series[data.series.length - 1];
  const first = data.series[0];
  const peak = data.series.reduce((m, p) => (p.allActive > m ? p.allActive : m), 0);
  const delta = last.allActive - first.allActive;
  const deltaPct = first.allActive > 0 ? (delta / first.allActive) * 100 : 0;

  const labels = data.series.map((p) =>
    granularity === 'month' ? p.bucket.slice(0, 7) : p.bucket.slice(5),
  );

  return (
    <div>
      <div className="kpi-grid">
        <KpiCard label="Activos al final" value={last.allActive} sub={`al ${last.bucket}`} />
        <KpiCard label="Pico en rango" value={peak} variant="blue" />
        <KpiCard
          label="Variación"
          value={`${delta >= 0 ? '+' : ''}${delta.toLocaleString()}`}
          sub={`${deltaPct.toFixed(1)}%`}
          variant={delta >= 0 ? 'green' : 'red'}
        />
        <KpiCard label="Buckets" value={data.series.length} sub={granularity} />
      </div>

      <div className="chart-full">
        <div className="chart-title">Activos por tipo de acceso · {granularity}</div>
        <div style={{ height: 300 }}>
          <StackedAreaChart
            height={300}
            labels={labels}
            series={[
              { label: 'Real', data: data.series.map((p) => p.realActive), color: ACCESS_COLORS.real },
              { label: 'Voucher', data: data.series.map((p) => p.voucherActive), color: ACCESS_COLORS.voucher },
            ]}
          />
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text3)' }}>
          Total activos (incluye Antel): {last.allActive.toLocaleString()}
        </div>
      </div>

      <div className="chart-full">
        <div className="chart-title">Mix por subtipo · evolución</div>
        <div style={{ height: 280 }}>
          <StackedAreaChart
            height={280}
            labels={labels}
            series={[
              { label: 'Free', data: data.series.map((p) => p.freeActive), color: SUB_COLORS.Free },
              { label: 'Mensual básico', data: data.series.map((p) => p.mensualBasicoActive), color: SUB_COLORS.Mensual_Basico },
              { label: 'Mensual total', data: data.series.map((p) => p.mensualTotalActive), color: SUB_COLORS.Mensual_Total },
              { label: 'Anual total', data: data.series.map((p) => p.anualTotalActive), color: SUB_COLORS.Anual_Total },
            ]}
          />
        </div>
      </div>

      <div className="chart-full">
        <div className="chart-title">Total activos · línea</div>
        <div style={{ height: 220 }}>
          <LineChart
            height={220}
            labels={labels}
            series={[
              { label: 'Total activos', data: data.series.map((p) => p.allActive), color: '#06b6d4', fill: true },
            ]}
          />
        </div>
      </div>

      <div className="alert-box">
        <div className="alert-box-title">💡 Bandas de fase deportiva</div>
        <div>
          Disponibles al filtrar por <strong>1 país + 1 liga</strong> (filtro de liga · pendiente Phase 7).
        </div>
      </div>
    </div>
  );
}

