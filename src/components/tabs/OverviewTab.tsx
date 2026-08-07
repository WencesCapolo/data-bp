'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { KpiCard } from '@/components/ui/KpiCard';
import { LineChart } from '@/components/charts/LineChart';
import { DoughnutChart } from '@/components/charts/DoughnutChart';
import { BarChart } from '@/components/charts/BarChart';
import { useFilters, useFilterQS } from '@/lib/client/filterStore';
import { bucketTitles } from '@/lib/client/bucketTitle';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import { UserBaseSection } from './overview/UserBaseSection';
import type { OverviewDTO } from '@basket/core/dtos/OverviewDTO';

const ACCESS_COLORS = ['#10b981', '#06b6d4', '#fbbf24'];
const SUBTYPE_COLORS = ['#94a3b8', '#4f8ef7', '#22d3ee', '#a78bfa', '#fb923c'];
const COUNTRY_COLORS = ['#4f8ef7', '#22d3ee', '#f43f5e', '#a78bfa', '#34d399', '#fb923c', '#94a3b8'];

function rangeLabel(r: string): string {
  if (r === 'yesterday') return 'ayer';
  if (r === '7d') return '7 días';
  if (r === '30d') return '30 días';
  if (r === '90d') return '90 días';
  if (r === 'ytd') return 'YTD';
  if (r === 'all') return 'todo';
  if (r === 'custom') return 'rango personalizado';
  return r;
}

function fmtCurrency(n: number, c: string): string {
  try {
    return new Intl.NumberFormat('es-UY', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${c} ${new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 }).format(n)}`;
  }
}

export function OverviewTab() {
  const range = useFilters((s) => s.range);
  const filterQS = useFilterQS();
  const { data, error, isLoading } = useSWR<OverviewDTO>(
    `/api/basket/overview?${filterQS}`,
    fetcher,
    { refreshInterval: 300_000 },
  );

  if (isLoading) return <TabSkeleton kpis={8} blocks={[{ kind: 'full', height: 280 }, { kind: 'col2', height: 260 }]} />;
  if (error) return <ErrorBox message={error.message} />;
  if (!data) return null;

  const { kpis, trend, accessBreakdown, subTypeBreakdown, countryBreakdown } = data;

  return (
    <div>
      <div className="kpi-grid">
        <KpiCard label="Activos totales" value={kpis.activeAll} variant="default" sub={`al ${data.asOf}`} />
        <KpiCard label="Pagos reales" value={kpis.activeReal} variant="green" />
        <KpiCard label="Vouchers" value={kpis.activeVoucher} variant="blue" />
        <KpiCard label="Antel" value={kpis.activeAntel} variant="yellow" />
        <KpiCard label="Mensual básico" value={kpis.activeMensualBasico} />
        <KpiCard label="Mensual total" value={kpis.activeMensualTotal} />
        <KpiCard label="Anual total" value={kpis.activeAnualTotal} />
        <KpiCard label={`Nuevos pagadores ${rangeLabel(range)}`} value={kpis.newPayersInRange} variant="green" />
      </div>

      <UserBaseSection filterQS={filterQS} />

      <div className="chart-full">
        <div className="chart-title">Tendencia ({rangeLabel(range)}) · activos por tipo de acceso</div>
        <div style={{ height: 260 }}>
          <LineChart
            height={260}
            labels={trend.map((p) => p.day.slice(5))}
            tooltipTitles={bucketTitles(trend.map((p) => p.day), 'day')}
            series={[
              { label: 'Total', data: trend.map((p) => p.allActive), color: '#06b6d4', fill: true },
              { label: 'Reales', data: trend.map((p) => p.realActive), color: '#10b981' },
              { label: 'Vouchers', data: trend.map((p) => p.voucherActive), color: '#fbbf24' },
            ]}
          />
        </div>
      </div>

      <div className="col2">
        <div className="chart-card">
          <div className="chart-title">Mix de acceso</div>
          <div style={{ height: 220 }}>
            <DoughnutChart
              labels={accessBreakdown.map((b) => b.label)}
              values={accessBreakdown.map((b) => b.count)}
              colors={ACCESS_COLORS}
            />
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-title">Distribución por país · activos</div>
          <div style={{ height: 220 }}>
            <DoughnutChart
              labels={countryBreakdown.map((b) => b.label)}
              values={countryBreakdown.map((b) => b.count)}
              colors={COUNTRY_COLORS}
            />
          </div>
        </div>
      </div>

      <div className="chart-full">
        <div className="chart-title">Mix por subtipo · activos</div>
        <div style={{ height: 220 }}>
          <BarChart
            labels={subTypeBreakdown.map((b) => b.label)}
            values={subTypeBreakdown.map((b) => b.count)}
            color={SUBTYPE_COLORS[1]}
          />
        </div>
      </div>

      <div className="col2">
        <div className="summary-card">
          <div className="summary-card-title">💰 Revenue · {rangeLabel(range)}</div>
          <div className="summary-card-body">
            {kpis.revenueInRangeByCurrency.length === 0 ? (
              <div>(sin datos)</div>
            ) : (
              kpis.revenueInRangeByCurrency.map((r) => (
                <div key={r.currency}>
                  {r.currency}: <strong style={{ color: 'var(--text)' }}>{fmtCurrency(r.amount, r.currency)}</strong>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card-title">📊 Resumen</div>
          <div className="summary-card-body">
            <div>Total activos: <strong style={{ color: 'var(--text)' }}>{kpis.activeAll.toLocaleString()}</strong></div>
            <div>Reales: {((kpis.activeReal / Math.max(1, kpis.activeAll)) * 100).toFixed(1)}%</div>
            <div>Top país: {countryBreakdown[0]?.label} ({countryBreakdown[0]?.count.toLocaleString()})</div>
          </div>
        </div>
      </div>

      <div className="alert-box">
        <div className="alert-box-title">🚨 Insights</div>
        <div>
          {kpis.activeAll.toLocaleString()} activos totales · {countryBreakdown.length} países con presencia ·
          mix dominante: <strong>{subTypeBreakdown[0]?.label}</strong> ({subTypeBreakdown[0]?.pct.toFixed(1)}%)
        </div>
      </div>
    </div>
  );
}


