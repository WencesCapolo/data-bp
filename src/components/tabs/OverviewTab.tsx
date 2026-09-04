'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { KpiCard } from '@/components/ui/KpiCard';
import { InfoHint } from '@/components/ui/InfoHint';
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
        <KpiCard
          label="Activos totales"
          value={kpis.activeAll}
          variant="default"
          sub={`al ${data.asOf}`}
          hint="Suscriptores distintos con una Subscription vigente al día indicado: Pago exitoso, más 7 días de gracia tras el vencimiento. Incluye vouchers y Antel; no depende del rango."
        />
        <KpiCard
          label="Pagos reales"
          value={kpis.activeReal}
          variant="green"
          hint="Suscriptores activos cuya Subscription se pagó con dinero (Pago con monto mayor a cero), sin contar Antel. Mismo criterio de vigencia que Activos totales."
        />
        <KpiCard
          label="Vouchers"
          value={kpis.activeVoucher}
          variant="blue"
          hint="Suscriptores activos con acceso otorgado sin cobro: Pago exitoso con monto cero (voucher o carga manual), excluyendo Antel."
        />
        <KpiCard
          label="Antel"
          value={kpis.activeAntel}
          variant="yellow"
          hint="Suscriptores activos cuya Subscription factura Antel como Provider. Cuentan como activos aunque el Pago registre monto cero."
        />
        <KpiCard
          label="Mensual básico"
          value={kpis.activeMensualBasico}
          hint="Suscriptores activos con Tier Mensual Básico (Period de 30 días al precio básico). El Tier se deduce del precio del Pago; el Export no lo informa."
        />
        <KpiCard
          label="Mensual total"
          value={kpis.activeMensualTotal}
          hint="Suscriptores activos con Tier Mensual Total (Period de 30 días al precio total). El Tier se deduce del precio del Pago; el Export no lo informa."
        />
        <KpiCard
          label="Anual total"
          value={kpis.activeAnualTotal}
          hint="Suscriptores activos con Tier Anual Total (Period de 365 días). Un suscriptor con Pagos vigentes de dos Tiers distintos cuenta en ambos."
        />
        <KpiCard
          label={`Nuevos pagadores ${rangeLabel(range)}`}
          value={kpis.newPayersInRange}
          variant="green"
          hint="Suscriptores cuyo primer Pago exitoso de toda su historia cae dentro del rango seleccionado. Incluye vouchers y Antel, no solo Pagos con dinero."
        />
      </div>

      <UserBaseSection filterQS={filterQS} />

      <div className="chart-full">
        <div className="chart-title">
          Tendencia ({rangeLabel(range)}) · activos por tipo de acceso
          <InfoHint text="Suscriptores activos por día en el rango seleccionado: Total (incluye Antel), Reales (pagaron con dinero) y Vouchers (sin cobro). Llega hasta ayer; hoy se excluye por estar incompleto." />
        </div>
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
          <div className="chart-title">
            Mix de acceso
            <InfoHint text="Reparto de los activos a la fecha según Access Type: real (pagó con dinero), voucher (Pago con monto cero, sin Provider) y antel (facturado por Antel)." />
          </div>
          <div style={{ height: 220 }}>
            <DoughnutChart
              labels={accessBreakdown.map((b) => b.label)}
              values={accessBreakdown.map((b) => b.count)}
              colors={ACCESS_COLORS}
            />
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-title">
            Distribución por país · activos
            <InfoHint text="Activos a la fecha según el país de la cuenta del Suscriptor, no el del Pago. Uruguay, Argentina y Chile van por separado; el resto se agrupa en Other." />
          </div>
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
        <div className="chart-title">
          Mix por subtipo · activos
          <InfoHint text="Activos a la fecha por Tier: Free (Period 0), Mensual Básico, Mensual Total y Anual Total. Los Pagos sin Tier reconocible (Otros) no se grafican." />
        </div>
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
          <div className="summary-card-title">
            💰 Revenue · {rangeLabel(range)}
            <InfoHint text="Suma bruta de los Pagos exitosos con monto mayor a cero fechados en el rango seleccionado, por moneda y sin conversión. No descuenta comisiones del Provider ni cuenta intentos fallidos." />
          </div>
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
          <div className="summary-card-title">
            📊 Resumen
            <InfoHint text="Lectura rápida de las tarjetas de arriba: activos totales a la fecha, qué porcentaje de ellos pagó con dinero y el país con más activos." />
          </div>
          <div className="summary-card-body">
            <div>Total activos: <strong style={{ color: 'var(--text)' }}>{kpis.activeAll.toLocaleString()}</strong></div>
            <div>Reales: {((kpis.activeReal / Math.max(1, kpis.activeAll)) * 100).toFixed(1)}%</div>
            <div>Top país: {countryBreakdown[0]?.label} ({countryBreakdown[0]?.count.toLocaleString()})</div>
          </div>
        </div>
      </div>

      <div className="alert-box">
        <div className="alert-box-title">
          🚨 Insights
          <InfoHint text="Frase armada con los mismos datos de esta pestaña: activos totales a la fecha, los grupos de país listados (Uruguay, Argentina, Chile y Other) y el Tier con más activos." />
        </div>
        <div>
          {kpis.activeAll.toLocaleString()} activos totales · {countryBreakdown.length} países con presencia ·
          mix dominante: <strong>{subTypeBreakdown[0]?.label}</strong> ({subTypeBreakdown[0]?.pct.toFixed(1)}%)
        </div>
      </div>
    </div>
  );
}


