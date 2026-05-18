'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { KpiCard } from '@/components/ui/KpiCard';
import { LineChart } from '@/components/charts/LineChart';
import { DoughnutChart } from '@/components/charts/DoughnutChart';
import { BarChart } from '@/components/charts/BarChart';
import { useFilters } from '@/lib/client/filterStore';
import type { OverviewDTO } from '@basket/core/dtos/OverviewDTO';

const ACCESS_COLORS = ['#10b981', '#06b6d4', '#fbbf24'];
const SUBTYPE_COLORS = ['#94a3b8', '#4f8ef7', '#22d3ee', '#a78bfa', '#fb923c'];
const COUNTRY_COLORS = ['#4f8ef7', '#22d3ee', '#f43f5e', '#a78bfa', '#34d399', '#fb923c', '#94a3b8'];

function fmtCurrency(n: number, c: string): string {
  return new Intl.NumberFormat('es-UY', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);
}

function buildOverviewUrl(s: {
  countries: string[];
  accessType?: string;
  subType?: string;
}): string {
  const p = new URLSearchParams();
  for (const c of s.countries) p.append('countries', c);
  if (s.accessType) p.set('accessType', s.accessType);
  if (s.subType) p.set('subType', s.subType);
  const qs = p.toString();
  return qs ? `/api/basket/overview?${qs}` : '/api/basket/overview';
}

export function OverviewTab() {
  const countries = useFilters((s) => s.countries);
  const accessType = useFilters((s) => s.accessType);
  const subType = useFilters((s) => s.subType);
  const url = buildOverviewUrl({ countries, accessType, subType });
  const { data, error, isLoading } = useSWR<OverviewDTO>(url, fetcher, {
    refreshInterval: 300_000,
  });

  if (isLoading) return <SkeletonOverview />;
  if (error) return <ErrorBox message={error.message} />;
  if (!data) return null;

  const { kpis, trend30d, accessBreakdown, subTypeBreakdown, countryBreakdown } = data;

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
        <KpiCard label="Nuevos pagadores 30d" value={kpis.newPayersLast30d} variant="green" />
      </div>

      <div className="chart-full">
        <div className="chart-title">Tendencia 30 días · activos por tipo de acceso</div>
        <div style={{ height: 260 }}>
          <LineChart
            height={260}
            labels={trend30d.map((p) => p.day.slice(5))}
            series={[
              { label: 'Total', data: trend30d.map((p) => p.allActive), color: '#06b6d4', fill: true },
              { label: 'Reales', data: trend30d.map((p) => p.realActive), color: '#10b981' },
              { label: 'Vouchers', data: trend30d.map((p) => p.voucherActive), color: '#fbbf24' },
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
          <div className="summary-card-title">💰 Revenue últimos 30 días</div>
          <div className="summary-card-body">
            {kpis.revenueLast30dByCurrency.length === 0 ? (
              <div>(sin datos)</div>
            ) : (
              kpis.revenueLast30dByCurrency.map((r) => (
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

function SkeletonOverview() {
  return (
    <div>
      <div className="kpi-grid">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 96 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 280, marginBottom: 24 }} />
      <div className="col2">
        <div className="skeleton" style={{ height: 260 }} />
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="alert-box" style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)' }}>
      <div className="alert-box-title" style={{ color: 'var(--red)' }}>⚠ Error</div>
      <div style={{ fontFamily: 'DM Mono, monospace' }}>{message}</div>
    </div>
  );
}
