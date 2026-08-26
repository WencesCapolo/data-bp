'use client';
import { useMemo, useState, type CSSProperties } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { useFilterQS } from '@/lib/client/filterStore';
import { bucketTitles } from '@/lib/client/bucketTitle';
import { KpiCard } from '@/components/ui/KpiCard';
import { LineChart } from '@/components/charts/LineChart';
import { DoughnutChart } from '@/components/charts/DoughnutChart';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import type { EconomiaDTO } from '@basket/core/dtos/EconomiaDTO';

const CURRENCY_COLORS: Record<string, string> = {
  UYU: '#22d3ee',
  USD: '#10b981',
  ARS: '#4f8ef7',
  CLP: '#f43f5e',
  BRL: '#a78bfa',
  EUR: '#fbbf24',
  BOB: '#fb923c',
  PEN: '#94a3b8',
  NONE: '#64748b',
};
const STATUS_COLORS: Record<string, string> = {
  active: '#10b981',
  canceled: '#f43f5e',
  incomplete_expired: '#fb923c',
  past_due: '#fbbf24',
  incomplete: '#94a3b8',
};
const NOTE: CSSProperties = { marginTop: 8, fontSize: 10, color: 'var(--text3)' };

function fmtExact(n: number, c: string): string {
  if (!c || c === 'NONE') return n.toLocaleString('es-UY', { maximumFractionDigits: 2 });
  return new Intl.NumberFormat('es-UY', {
    style: 'currency',
    currency: c,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
function fmtRound(n: number, c: string): string {
  if (!c || c === 'NONE') return n.toLocaleString('es-UY', { maximumFractionDigits: 0 });
  return new Intl.NumberFormat('es-UY', {
    style: 'currency',
    currency: c,
    maximumFractionDigits: 0,
  }).format(n);
}

export function EconomiaTab() {
  const url = `/api/financiero/economia?${useFilterQS()}`;
  const { data, error, isLoading } = useSWR<EconomiaDTO>(url, fetcher);
  // Gross lives in seven presentment currencies that cannot be added together,
  // so the tab shows one at a time rather than a stacked total that means
  // nothing. Defaults to the biggest currency in range.
  const [grossCcy, setGrossCcy] = useState<string | null>(null);

  const currencies = useMemo(() => {
    if (!data) return [] as { currency: string; gross: number }[];
    const idx: Record<string, number> = {};
    for (const r of data.monthlyGross) idx[r.currency] = (idx[r.currency] ?? 0) + r.gross;
    return Object.entries(idx)
      .map(([currency, gross]) => ({ currency, gross }))
      .sort((a, b) => b.gross - a.gross);
  }, [data]);

  const activeCcy = grossCcy ?? currencies[0]?.currency ?? null;

  // Gross per month for the selected currency, split by platform — this is the
  // only place MercadoPago and PayPal appear, since neither has a fee feed.
  const grossMonthly = useMemo(() => {
    if (!data || !activeCcy) return { labels: [] as string[], series: [] as { label: string; data: number[]; color: string }[] };
    const rows = data.monthlyGross.filter((r) => r.currency === activeCcy);
    const months = Array.from(new Set(rows.map((r) => r.month))).sort();
    const plats = Array.from(new Set(rows.map((r) => r.platformName)));
    const idx: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      idx[r.month] ??= {};
      idx[r.month][r.platformName] = (idx[r.month][r.platformName] ?? 0) + r.gross;
    }
    const PLAT: Record<string, string> = {
      MercadoPago: '#06b6d4',
      Stripe: '#a78bfa',
      PayPal: '#4f8ef7',
      Antel: '#fb923c',
      Voucher: '#fbbf24',
      Manual: '#94a3b8',
      Unknown: '#64748b',
    };
    return {
      labels: months.map((m) => m.slice(0, 7)),
      series: plats.map((p) => ({
        label: p,
        data: months.map((m) => idx[m]?.[p] ?? 0),
        color: PLAT[p] ?? '#64748b',
      })),
    };
  }, [data, activeCcy]);

  // Net and fees, settlement plane, one chart per settlement currency.
  const netMonthly = useMemo(() => {
    if (!data) return [] as { ccy: string; platformName: string; labels: string[]; series: { label: string; data: number[]; color: string }[] }[];
    const rows = data.gateway.netByMonth;
    return data.gateway.settlementTotals.map((t) => {
      // Matched on platform AND currency: two Providers settling the same
      // currency would otherwise stack into one bar with two fee structures.
      const mine = rows
        .filter((r) => r.settlementCurrency === t.settlementCurrency && r.platform === t.platform)
        .sort((a, b) => (a.month < b.month ? -1 : 1));
      return {
        ccy: t.settlementCurrency,
        platformName: t.platformName,
        labels: mine.map((r) => r.month.slice(0, 7)),
        series: [
          { label: `Neto ${t.settlementCurrency}`, data: mine.map((r) => r.net), color: '#10b981' },
          { label: `Comisión ${t.settlementCurrency}`, data: mine.map((r) => r.fees), color: '#f43f5e' },
          // Only where the Provider withholds. Stacking a flat zero would read
          // as "we checked and there is none", which is only true for Stripe.
          ...(t.taxes > 0
            ? [{ label: `Retenciones ${t.settlementCurrency}`, data: mine.map((r) => r.taxes), color: '#f59e0b' }]
            : []),
        ],
      };
    });
  }, [data]);

  const netDaily = useMemo(() => {
    if (!data) return { labels: [] as string[], series: [] as { label: string; data: number[]; color: string; fill: boolean }[] };
    const rows = data.gateway.netByDay;
    const days = Array.from(new Set(rows.map((r) => r.day))).sort();
    const ccys = Array.from(new Set(rows.map((r) => r.settlementCurrency)));
    const idx: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      idx[r.day] ??= {};
      idx[r.day][r.settlementCurrency] = (idx[r.day][r.settlementCurrency] ?? 0) + r.net;
    }
    return {
      labels: days,
      series: ccys.map((c) => ({
        label: `${c} neto`,
        data: days.map((day) => idx[day]?.[c] ?? 0),
        color: CURRENCY_COLORS[c] ?? '#94a3b8',
        fill: true,
      })),
    };
  }, [data]);

  // Plan mix: transactions per plan family × frequency, currency-independent, so
  // it is the one chart here that can aggregate everything in range.
  // USD, one line per Provider × settlement currency. A month with no rate is
  // null and the line breaks there — the whole point of the FX table is that a
  // missing rate is visible as missing rather than as a month of no revenue.
  const usdMonthly = useMemo(() => {
    if (!data) return { labels: [] as string[], series: [] as { label: string; data: (number | null)[]; color: string }[] };
    const rows = data.gateway.netUsdByMonth.filter((r) => r.rateSource !== null);
    const months = Array.from(new Set(rows.map((r) => r.month))).sort();
    const keys = Array.from(new Set(rows.map((r) => `${r.platform}:${r.settlementCurrency}`)));
    const idx: Record<string, Record<string, number | null>> = {};
    for (const r of rows) {
      idx[`${r.platform}:${r.settlementCurrency}`] ??= {};
      idx[`${r.platform}:${r.settlementCurrency}`][r.month] = r.netUsd;
    }
    return {
      labels: months.map((m) => m.slice(0, 7)),
      series: keys.map((k) => {
        const sample = rows.find((r) => `${r.platform}:${r.settlementCurrency}` === k)!;
        return {
          label: `${sample.platformName} · ${sample.settlementCurrency}→USD`,
          data: months.map((m) => idx[k]?.[m] ?? null),
          color: CURRENCY_COLORS[sample.settlementCurrency] ?? '#64748b',
        };
      }),
    };
  }, [data]);

  const planMix = useMemo(() => {
    if (!data) return [] as { label: string; txCount: number }[];
    const idx: Record<string, number> = {};
    for (const r of data.catalog) {
      const k = `${r.planFamily} · ${r.planFrequency}`;
      idx[k] = (idx[k] ?? 0) + r.txCount;
    }
    return Object.entries(idx)
      .map(([label, txCount]) => ({ label, txCount }))
      .sort((a, b) => b.txCount - a.txCount);
  }, [data]);

  if (isLoading) {
    return (
      <TabSkeleton
        kpis={4}
        blocks={[{ kind: 'full', height: 300 }, { kind: 'col2', height: 260 }, { kind: 'full', height: 280 }]}
      />
    );
  }
  if (error) return <ErrorBox message={error.message} />;
  if (!data) return null;

  const g = data.gateway;
  const usd = g.settlementTotals.find((t) => t.settlementCurrency === 'USD');
  const topCcy = currencies[0];
  const totalTx = data.monthlyDetail.reduce((s, r) => s + r.txCount, 0);
  const activeSubs = g.subscriptionsByStatus.find((r) => r.status === 'active')?.count ?? 0;
  const canceledStatus = g.subscriptionsByStatus.find((r) => r.status === 'canceled');
  const undatedCancels = canceledStatus ? canceledStatus.count - canceledStatus.withCanceledAt : 0;
  const detailByCcy = activeCcy ? data.monthlyDetail.filter((r) => r.currency === activeCcy) : [];
  // Coverage over fee-BEARING Pagos only. MercadoPago's preapprovals are
  // subscription objects that never had a commission, so averaging them in
  // would cap the figure near 73% and read as a permanent loss.
  const payCoverage = g.coverage.reduce(
    (acc, r) => (r.idShape === 'preapproval'
      ? { ...acc, preapprovals: acc.preapprovals + r.successful }
      : { ...acc, withFee: acc.withFee + r.withFee, successful: acc.successful + r.successful }),
    { withFee: 0, successful: 0, preapprovals: 0 },
  );

  return (
    <div>
      <div className="kpi-grid">
        <KpiCard label="Transacciones en rango" value={totalTx} variant="blue" />
        <KpiCard
          label={`Bruto ${topCcy?.currency ?? '—'} · cobro`}
          value={topCcy ? fmtRound(topCcy.gross, topCcy.currency) : '—'}
          sub={`moneda más grande del rango · ${currencies.length} monedas en total`}
        />
        <KpiCard
          label={`Neto ${usd?.settlementCurrency ?? 'USD'} · liquidación ${g.platformName}`}
          value={usd ? fmtExact(usd.net, usd.settlementCurrency) : '—'}
          sub={usd ? `comisión ${fmtExact(usd.fees, usd.settlementCurrency)} · ${usd.feePct}% · ${usd.txCount.toLocaleString()} tx` : 'sin comisiones en rango'}
          variant="green"
        />
        <KpiCard
          label={`Suscripciones activas · ${g.subscriptionPlatformName}`}
          value={activeSubs}
          sub={`${g.subscriptionsByStatus.reduce((s, r) => s + r.count, 0).toLocaleString()} en total`}
          variant="yellow"
        />
      </div>

      <div className="chart-full">
        <div className="chart-title">Ingresos brutos mes a mes · por plataforma</div>
        <div className="date-pills" style={{ marginBottom: 10 }}>
          {currencies.map((c) => (
            <button
              key={c.currency}
              className={`date-pill ${c.currency === activeCcy ? 'active' : ''}`}
              onClick={() => setGrossCcy(c.currency)}
            >
              {c.currency}
            </button>
          ))}
        </div>
        <div style={{ height: 280 }}>
          {grossMonthly.labels.length === 0 ? (
            <div className="no-data">Sin ingresos en rango</div>
          ) : (
            <StackedBarChart
              height={280}
              labels={grossMonthly.labels}
              tooltipTitles={bucketTitles(grossMonthly.labels, 'month')}
              series={grossMonthly.series}
            />
          )}
        </div>
        <div style={NOTE}>
          Plano de <strong>cobro</strong>, en {activeCcy}: lo que se le facturó al
          suscriptor. Una moneda por vez: apilar monedas distintas no daría un
          total. La conversión a USD vive en su propio bloque más abajo, sobre el
          plano de <strong>liquidación</strong> y con la cotización a la vista.
          {data.grossOnlyPlatforms.length > 0 && (
            <>
              {' '}
              {data.grossOnlyPlatforms.join(', ')} aparece{data.grossOnlyPlatforms.length > 1 ? 'n' : ''} acá
              pero <strong>no</strong> en las cifras netas: no tenemos su feed de comisiones.
            </>
          )}
        </div>
      </div>

      <div className="col2">
        {netMonthly.map((c) => (
          <div className="chart-card" key={`${c.platformName}:${c.ccy}`}>
            <div className="chart-title">Ingresos netos {c.ccy} · {c.platformName}</div>
            <div style={{ height: 240 }}>
              {c.labels.length === 0 ? (
                <div className="no-data">Sin datos</div>
              ) : (
                <StackedBarChart
                  height={240}
                  labels={c.labels}
                  tooltipTitles={bucketTitles(c.labels, 'month')}
                  series={c.series}
                />
              )}
            </div>
            <div style={NOTE}>
              Apilado = bruto liquidado en {c.ccy}. Plano de liquidación: lo que
              el gateway movió, no lo que se facturó. La retención impositiva va
              aparte de la comisión: la comisión se gasta, la retención vuelve
              como crédito fiscal.
            </div>
          </div>
        ))}
      </div>

      <div className="chart-full">
        <div className="chart-title">Ingresos netos en USD · convertidos día por día</div>
        <div style={{ height: 280 }}>
          {usdMonthly.series.length === 0 ? (
            <div className="no-data">Sin cotización para las monedas del rango</div>
          ) : (
            <LineChart
              height={280}
              labels={usdMonthly.labels}
              tooltipTitles={bucketTitles(usdMonthly.labels.map((m) => `${m}-01`), 'month')}
              series={usdMonthly.series}
              yFormat="currency"
            />
          )}
        </div>
        <table className="data-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Plataforma</th>
              <th>Moneda</th>
              <th style={{ textAlign: 'right' }}>Neto USD</th>
              <th>Cotización usada</th>
              <th style={{ textAlign: 'right' }}>Días</th>
            </tr>
          </thead>
          <tbody>
            {g.usdTotals.map((t) => (
              <tr key={`${t.platform}:${t.settlementCurrency}`}>
                <td>{t.platformName}</td>
                <td>{t.settlementCurrency}</td>
                <td style={{ textAlign: 'right' }}>
                  {/* Ausente, no cero: una moneda sin cotización no vale nada en
                      USD sólo porque nadie la cotiza. */}
                  {t.netUsd === null ? '—' : fmtExact(t.netUsd, 'USD')}
                </td>
                <td>
                  {t.rateLabel}
                  {t.effectiveRate !== null && (
                    <> · promedio ponderado {t.effectiveRate.toLocaleString('es-UY')} {t.settlementCurrency}/USD</>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {t.daysConverted.toLocaleString()}
                  {t.daysMissingRate > 0 && (
                    <span style={{ color: 'var(--red)' }}> · {t.daysMissingRate.toLocaleString()} sin cotización</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={NOTE}>
          Plano de <strong>liquidación</strong> convertido a USD <strong>por día</strong>,
          nunca al tipo de cambio de hoy ni al promedio del mes: con la inflación
          argentina, convertir un Pago de 2024 a la cotización actual no es un
          redondeo, es otro número. ARS usa el <strong>blue venta</strong> de
          dolarapi; los importes ya liquidados en USD no se convierten y se
          marcan como tales. Una moneda que ninguna fuente cotiza — hoy EUR —
          queda <strong>ausente</strong>, no en cero.
        </div>
      </div>

      <div className="chart-full">
        <div className="chart-title">Comisiones de pasarela · neto diario por moneda de liquidación</div>
        <div style={{ height: 280 }}>
          {netDaily.labels.length === 0 ? (
            <div className="no-data">Sin comisiones en rango</div>
          ) : (
            <LineChart
              height={280}
              labels={netDaily.labels.map((day) => day.slice(5))}
              tooltipTitles={bucketTitles(netDaily.labels, 'day')}
              series={netDaily.series}
              yFormat="currency"
            />
          )}
        </div>
        <div style={NOTE}>
          {g.platformName}: {payCoverage.withFee.toLocaleString()} de{' '}
          {payCoverage.successful.toLocaleString()} Pagos con id de gateway traen comisión.
          {payCoverage.preapprovals > 0 && (
            <> Quedan afuera {payCoverage.preapprovals.toLocaleString()} preaprobaciones de
            MercadoPago: son suscripciones, no cobros, y nunca tuvieron comisión que informar.</>
          )}{' '}
          Bucketeado por <code>captured_at</code> (UTC real), no por la fecha del Pago
          (hora local de Argentina).
          {g.netExcludesUnmatchedFees && (
            <> Con filtros activos sólo entran las comisiones cuyo Pago está ingestado.</>
          )}
        </div>
      </div>

      <div className="col2">
        <div className="chart-card">
          <div className="chart-title">Mix de planes · transacciones</div>
          <div style={{ height: 240 }}>
            {planMix.length === 0 ? (
              <div className="no-data">Sin datos</div>
            ) : (
              <DoughnutChart
                labels={planMix.map((p) => p.label)}
                values={planMix.map((p) => p.txCount)}
              />
            )}
          </div>
          <div style={NOTE}>
            Conteo de transacciones, no importe: es la única métrica de esta
            pestaña que se puede sumar entre monedas.
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-title">Suscripciones por estado · {g.platformName}</div>
          <div style={{ height: 240 }}>
            {g.subscriptionsByStatus.length === 0 ? (
              <div className="no-data">Sin suscripciones</div>
            ) : (
              <DoughnutChart
                labels={g.subscriptionsByStatus.map((r) => r.status)}
                values={g.subscriptionsByStatus.map((r) => r.count)}
                colors={g.subscriptionsByStatus.map((r) => STATUS_COLORS[r.status] ?? '#64748b')}
              />
            )}
          </div>
          <div style={NOTE}>
            Estado actual, en vocabulario del gateway. El churn se lee del{' '}
            <code>status</code>: {undatedCancels.toLocaleString()} de{' '}
            {(canceledStatus?.count ?? 0).toLocaleString()} cancelaciones no traen fecha.
            {g.subscriptionsIgnoreFilters && <> No afectado por los filtros.</>}
          </div>
        </div>
      </div>

      <div className="col2">
        <div className="chart-card">
          <div className="chart-title">Ingresos por país · plano de cobro</div>
          <div style={{ overflowX: 'auto', maxHeight: 320 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>País</th>
                  <th>Moneda</th>
                  <th style={{ textAlign: 'right' }}>Bruto</th>
                  <th style={{ textAlign: 'right' }}>Tx</th>
                  <th style={{ textAlign: 'right' }}>Pagadores</th>
                </tr>
              </thead>
              <tbody>
                {data.byCountry.slice(0, 40).map((r) => (
                  <tr key={`${r.country}-${r.currency}`}>
                    <td>{r.country}</td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: CURRENCY_COLORS[r.currency] ?? '#94a3b8',
                          marginRight: 8,
                        }}
                      />
                      {r.currency}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
                      {fmtRound(r.gross, r.currency)}
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.txCount.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', color: 'var(--green)' }}>
                      {r.payers.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={NOTE}>
            Una fila por país y moneda; sin fila de total, porque sumar ARS con
            UYU no da un número. Top 40 de {data.byCountry.length} filas.
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-title">Detalle mensual · {activeCcy}</div>
          <div style={{ overflowX: 'auto', maxHeight: 320 }}>
            {detailByCcy.length === 0 ? (
              <div className="no-data">Sin datos</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th style={{ textAlign: 'right' }}>Bruto</th>
                    <th style={{ textAlign: 'right' }}>Tx</th>
                    <th style={{ textAlign: 'right' }}>Pagadores</th>
                  </tr>
                </thead>
                <tbody>
                  {[...detailByCcy].reverse().map((r) => (
                    <tr key={r.month}>
                      <td>{r.month.slice(0, 7)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
                        {fmtRound(r.gross, r.currency)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{r.txCount.toLocaleString()}</td>
                      <td style={{ textAlign: 'right', color: 'var(--green)' }}>
                        {r.payers.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div style={NOTE}>Más reciente arriba. Cambia la moneda con los chips de arriba.</div>
        </div>
      </div>

      <div className="chart-full">
        <div className="chart-title">Catálogo · precios efectivamente cobrados</div>
        <div style={{ overflowX: 'auto', maxHeight: 360 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Frecuencia</th>
                <th>Mercado</th>
                <th>Temporada</th>
                <th>Moneda</th>
                <th style={{ textAlign: 'right' }}>Precio</th>
                <th style={{ textAlign: 'right' }}>Tx</th>
              </tr>
            </thead>
            <tbody>
              {data.catalog.slice(0, 60).map((r) => (
                <tr key={`${r.planFamily}-${r.planFrequency}-${r.market}-${r.season}-${r.currency}-${r.price}`}>
                  <td>{r.planFamily}</td>
                  <td>{r.planFrequency}</td>
                  <td>{r.market}</td>
                  <td>{r.season}</td>
                  <td>{r.currency}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
                    {fmtExact(r.price, r.currency)}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.txCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={NOTE}>
          El precio como se cobró, no como está configurado: un punto de precio
          que nadie pagó no aparece, y uno que cambió a mitad de temporada
          aparece dos veces. Temporada deportiva Sep→Ago. Top 60 de{' '}
          {data.catalog.length} combinaciones.
        </div>
      </div>
    </div>
  );
}
