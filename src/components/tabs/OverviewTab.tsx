'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard';
import { Card } from '@/components/ui/Card';
import { ACCESS, COUNTRY, OTHER, SERIES, TREND } from '@/lib/client/palette';
import { LineChart } from '@/components/charts/LineChart';
import { DoughnutChart } from '@/components/charts/DoughnutChart';
import { BarChart } from '@/components/charts/BarChart';
import { useFilters, useFilterQS } from '@/lib/client/filterStore';
import { bucketTitles } from '@/lib/client/bucketTitle';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import { UserBaseSection } from './overview/UserBaseSection';
import type { OverviewDTO } from '@basket/core/dtos/OverviewDTO';

// Amber for vouchers, as on every chart that splits real from voucher.
// In the order accessBreakdown lists them.
const ACCESS_COLORS = [ACCESS.real, ACCESS.antel, ACCESS.voucher];
const SUBTYPE_COLORS = [OTHER, SERIES[0], SERIES[1], SERIES[3], SERIES[5]];
const COUNTRY_COLORS = [COUNTRY.AR, COUNTRY.UY, COUNTRY.CL, COUNTRY.EC, COUNTRY.BR, COUNTRY.BO, OTHER];

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
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard
          label="Activos totales"
          value={kpis.activeAll}
          variant="default"
          sub={`al ${data.asOf}`}
          hint="Suscriptores distintos con una suscripción vigente al día indicado: Pago exitoso, más 7 días de gracia tras el vencimiento. Incluye vouchers y Antel; no depende del rango."
        />
        <KpiCard
          label="Pagos reales"
          value={kpis.activeReal}
          variant="green"
          hint="Suscriptores activos cuya suscripción se pagó con dinero (Pago con monto mayor a cero), sin contar Antel. Mismo criterio de vigencia que Activos totales."
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
          hint="Suscriptores activos cuya suscripción factura Antel como proveedor. Cuentan como activos aunque el Pago registre monto cero."
        />
        <KpiCard
          label="Mensual básico"
          value={kpis.activeMensualBasico}
          hint="Suscriptores activos con plan Mensual Básico (período de 30 días al precio básico)."
        />
        <KpiCard
          label="Mensual total"
          value={kpis.activeMensualTotal}
          hint="Suscriptores activos con plan Mensual Total (período de 30 días al precio total)."
        />
        <KpiCard
          label="Anual total"
          value={kpis.activeAnualTotal}
          hint="Suscriptores activos con plan Anual Total (período de 365 días). Un suscriptor con Pagos vigentes de dos planes distintos cuenta en ambos."
        />
        <KpiCard
          label={`Nuevos pagadores ${rangeLabel(range)}`}
          value={kpis.newPayersInRange}
          variant="green"
          hint="Suscriptores cuyo primer Pago exitoso de toda su historia cae dentro del rango seleccionado. Incluye vouchers y Antel, no solo Pagos con dinero."
        />
      </KpiGrid>

      <UserBaseSection filterQS={filterQS} />

      <Card
        title={`Tendencia (${rangeLabel(range)}) · activos por tipo de acceso`}
        hint="Suscriptores activos por día en el rango seleccionado. Reales (eje izquierdo) pagaron con dinero; Vouchers (eje derecho, línea punteada) tienen un Pago en $0 vigente. Casi todos los vouchers acompañan a un Pago real del mismo suscriptor, así que no se suman a Reales. Llega hasta ayer."
      >
        <LineChart
          height={260}
          labels={trend.map((p) => p.day.slice(5))}
          tooltipTitles={bucketTitles(trend.map((p) => p.day), 'day')}
          series={[
            // Total is not drawn: it sits within one subscriber of Reales, so
            // the two lines overlap. Vouchers is a subset of Reales, not a
            // slice — nearly every $0 pago twins a real one — and an order
            // of magnitude smaller, so it gets its own axis.
            { label: 'Reales', data: trend.map((p) => p.realActive), color: TREND.up, fill: true },
            { label: 'Vouchers', data: trend.map((p) => p.voucherActive), color: ACCESS.voucher, axis: 'right' },
          ]}
        />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title="Mix de acceso"
          hint="Reparto de los activos a la fecha según tipo de acceso: real (pagó con dinero), voucher (Pago con monto cero, sin proveedor) y antel (facturado por Antel)."
        >
          <DoughnutChart
            labels={accessBreakdown.map((b) => b.label)}
            values={accessBreakdown.map((b) => b.count)}
            colors={ACCESS_COLORS}
          />
        </Card>
        <Card
          title="Distribución por país · activos"
          hint="Activos a la fecha según el país de la cuenta del Suscriptor, no el del Pago. Uruguay, Argentina y Chile van por separado; el resto se agrupa en Other."
        >
          <DoughnutChart
            labels={countryBreakdown.map((b) => b.label)}
            values={countryBreakdown.map((b) => b.count)}
            colors={COUNTRY_COLORS}
          />
        </Card>
      </div>

      <Card
        title="Mix por subtipo · activos"
        hint="Activos a la fecha por plan: Free (período 0), Mensual Básico, Mensual Total y Anual Total. Los Pagos sin plan reconocible (Otros) no se grafican."
      >
        <BarChart
          labels={subTypeBreakdown.map((b) => b.label)}
          values={subTypeBreakdown.map((b) => b.count)}
          color={SUBTYPE_COLORS[1]}
        />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title={`💰 Revenue · ${rangeLabel(range)}`}
          hint="Suma bruta de los Pagos exitosos con monto mayor a cero fechados en el rango seleccionado, por moneda y sin conversión. No descuenta comisiones del proveedor ni cuenta intentos fallidos."
        >
          <div className="font-mono text-xs leading-loose text-n-700">
            {kpis.revenueInRangeByCurrency.length === 0 ? (
              <div>(sin datos)</div>
            ) : (
              kpis.revenueInRangeByCurrency.map((r) => (
                <div key={r.currency}>
                  {r.currency}: <strong className="text-foreground">{fmtCurrency(r.amount, r.currency)}</strong>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}


