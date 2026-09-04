'use client';
import { useMemo } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { useFilterQS } from '@/lib/client/filterStore';
import { bucketTitles } from '@/lib/client/bucketTitle';
import { KpiCard } from '@/components/ui/KpiCard';
import { InfoHint } from '@/components/ui/InfoHint';
import { LineChart } from '@/components/charts/LineChart';
import { DoughnutChart } from '@/components/charts/DoughnutChart';
import { StackedAreaChart } from '@/components/charts/StackedAreaChart';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import type { FinanceDTO } from '@basket/core/dtos/FinanceDTO';

const CURRENCY_COLORS: Record<string, string> = {
  UYU: '#22d3ee',
  USD: '#10b981',
  ARS: '#4f8ef7',
  CLP: '#f43f5e',
  BRL: '#a78bfa',
};
const PLATFORM_COLORS: Record<string, string> = {
  MercadoPago: '#06b6d4',
  PayPal: '#4f8ef7',
  Stripe: '#a78bfa',
  Antel: '#fb923c',
  Voucher: '#fbbf24',
  Manual: '#94a3b8',
  Unknown: '#64748b',
};

function fmtCurrency(n: number, c: string): string {
  return new Intl.NumberFormat('es-UY', {
    style: 'currency',
    currency: c || 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function FinanceTab() {
  const url = `/api/basket/finance?${useFilterQS()}`;
  const { data, error, isLoading } = useSWR<FinanceDTO>(url, fetcher);

  const dailyByCurrency = useMemo(() => {
    if (!data) return { labels: [], series: [] as { label: string; data: number[]; color: string; fill: boolean }[] };
    const dates = Array.from(new Set(data.revenueByDay.map((r) => r.day))).sort();
    const currencies = Array.from(new Set(data.revenueByDay.map((r) => r.currency)));
    const idx: Record<string, Record<string, number>> = {};
    for (const r of data.revenueByDay) {
      idx[r.day] ??= {};
      idx[r.day][r.currency] = (idx[r.day][r.currency] ?? 0) + r.totalAmount;
    }
    return {
      labels: dates,
      series: currencies.map((c) => ({
        label: c,
        data: dates.map((day) => idx[day]?.[c] ?? 0),
        color: CURRENCY_COLORS[c] ?? '#94a3b8',
        fill: true,
      })),
    };
  }, [data]);

  const platformMonthlyStacked = useMemo(() => {
    if (!data) return { labels: [] as string[], series: [] as { label: string; data: number[]; color: string }[] };
    const months = Array.from(new Set(data.platformMonthly.map((r) => r.month))).sort();
    const plats = Array.from(new Set(data.platformMonthly.map((r) => r.platformName)));
    const idx: Record<string, Record<string, number>> = {};
    for (const r of data.platformMonthly) {
      idx[r.month] ??= {};
      idx[r.month][r.platformName] = (idx[r.month][r.platformName] ?? 0) + r.totalAmount;
    }
    return {
      labels: months.map((m) => m.slice(0, 7)),
      series: plats.map((p) => ({
        label: p,
        data: months.map((m) => idx[m]?.[p] ?? 0),
        color: PLATFORM_COLORS[p] ?? '#94a3b8',
      })),
    };
  }, [data]);

  if (isLoading) return <TabSkeleton kpis={4} blocks={[{ kind: 'full', height: 300 }, { kind: 'col2', height: 260 }, { kind: 'full', height: 280 }]} />;
  if (error) return <ErrorBox message={error.message} />;
  if (!data) return null;

  const topCurrency = data.byCurrency[0];
  const totalPayments = data.byCurrency.reduce((s, c) => s + c.paymentCount, 0);

  return (
    <div>
      <div className="kpi-grid">
        <KpiCard
          label="Pagos en rango"
          value={totalPayments}
          variant="blue"
          hint="Cantidad de Pagos exitosos con cobro (monto mayor a cero, más Antel) fechados en el rango, todas las monedas juntas. Excluye intentos fallidos; con filtros activos cuenta también los vouchers."
        />
        <KpiCard
          label={`Top moneda · ${topCurrency?.currency ?? '—'}`}
          value={topCurrency ? fmtCurrency(topCurrency.totalAmount, topCurrency.currency) : '—'}
          variant="green"
          hint="La moneda con mayor recaudación bruta en el rango y su total, expresado en esa misma moneda. Sin conversión y antes de descontar comisiones del proveedor."
        />
        <KpiCard
          label="Plataformas"
          value={data.byPlatform.length}
          hint="Cantidad de proveedores distintos con al menos un Pago en el rango: MercadoPago, Stripe, PayPal, Antel, Manual o Voucher."
        />
        <KpiCard
          label="Monedas"
          value={data.byCurrency.length}
          variant="yellow"
          hint="Cantidad de monedas distintas en las que se registraron Pagos con cobro dentro del rango seleccionado."
        />
      </div>

      <div className="chart-full">
        <div className="chart-title">
          Ingresos diarios por moneda
          <InfoHint text="Suma bruta por día de los Pagos exitosos, una línea por moneda, según la fecha del Pago. Sin conversión entre monedas ni descuento de comisiones del proveedor. Llega hasta ayer." />
        </div>
        <div style={{ height: 280 }}>
          {dailyByCurrency.labels.length === 0 ? (
            <div className="no-data">Sin ingresos en rango</div>
          ) : (
            <LineChart
              height={280}
              labels={dailyByCurrency.labels.map((d) => d.slice(5))}
              tooltipTitles={bucketTitles(dailyByCurrency.labels, 'day')}
              series={dailyByCurrency.series}
              yFormat="currency"
            />
          )}
        </div>
      </div>

      <div className="col2">
        <div className="chart-card">
          <div className="chart-title">
            Distribución por moneda
            <InfoHint text="Recaudación bruta del rango por moneda. Cada porción está en su propia moneda, sin conversión, así que los tamaños no son comparables entre sí." />
          </div>
          <div style={{ height: 240 }}>
            <DoughnutChart
              labels={data.byCurrency.map((c) => c.currency)}
              values={data.byCurrency.map((c) => c.totalAmount)}
              colors={data.byCurrency.map((c) => CURRENCY_COLORS[c.currency] ?? '#94a3b8')}
            />
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-title">
            Plataforma · monto y conteo
            <InfoHint text="Por proveedor: Pagos exitosos en el rango, la suma de sus montos y cuántos fueron con dinero (Reales). El monto mezcla todas las monedas sin convertir, así que solo orienta." />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plataforma</th>
                  <th style={{ textAlign: 'right' }}>Pagos</th>
                  <th style={{ textAlign: 'right' }}>Monto</th>
                  <th style={{ textAlign: 'right' }}>Reales</th>
                </tr>
              </thead>
              <tbody>
                {data.byPlatform.map((p) => (
                  <tr key={p.platform}>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: PLATFORM_COLORS[p.platformName] ?? '#94a3b8',
                          marginRight: 8,
                        }}
                      />
                      {p.platformName}
                    </td>
                    <td style={{ textAlign: 'right' }}>{p.paymentCount.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
                      {p.totalAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--green)' }}>
                      {p.realCount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="chart-full">
        <div className="chart-title">
          Mensual por plataforma · monto stacked
          <InfoHint text="Recaudación bruta por mes y proveedor, apilada, según la fecha del Pago. Suma todas las monedas sin convertir y no descuenta comisiones del proveedor." />
        </div>
        <div style={{ height: 260 }}>
          {platformMonthlyStacked.labels.length === 0 ? (
            <div className="no-data">Sin datos</div>
          ) : (
            <StackedAreaChart
              height={260}
              labels={platformMonthlyStacked.labels}
              tooltipTitles={bucketTitles(platformMonthlyStacked.labels, 'month')}
              series={platformMonthlyStacked.series}
            />
          )}
        </div>
      </div>
    </div>
  );
}


