'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { useFilterQS } from '@/lib/client/filterStore';
import { bucketTitles } from '@/lib/client/bucketTitle';
import { KpiCard } from '@/components/ui/KpiCard';
import { InfoHint } from '@/components/ui/InfoHint';
import { LineChart } from '@/components/charts/LineChart';
import { DoughnutChart } from '@/components/charts/DoughnutChart';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { ComboChart } from '@/components/financiero/contenido/ComboChart';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import { Card, Pending, SectionLabel } from './financiero/blocks';
import type { EconomiaDTO } from '@basket/core/dtos/EconomiaDTO';

/**
 * La vista Financiero de /financiero, en el orden del prototipo.
 *
 * `public/dashboard.html` es un scroll único: snapshot del mes, dos bloques de
 * KPIs, la vista consolidada, y después los cortes de mayor a menor grano. Las
 * tres pestañas que había acá (Economía · Suscripciones · Real vs Plan) partían
 * ese scroll en tres y escondían dos tercios de la pantalla detrás de una
 * pestaña que no muestra números. Ahora el orden es el del prototipo y cada
 * hueco dice, en el sitio del gráfico, por qué está vacío.
 *
 * Nada de lo que se dibuja acá suma monedas distintas. El bruto vive en el
 * plano de **cobro** y en siete monedas; el neto vive en el plano de
 * **liquidación** y se convierte a USD día por día. Son dos números diferentes
 * de la misma venta y mezclarlos es el error más fácil de cometer en esta
 * pantalla.
 */

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
const PLATFORM_COLORS: Record<string, string> = {
  MercadoPago: '#06b6d4',
  Stripe: '#a78bfa',
  PayPal: '#4f8ef7',
  Antel: '#fb923c',
  Voucher: '#fbbf24',
  Manual: '#94a3b8',
  Unknown: '#64748b',
};
const STATUS_COLORS: Record<string, string> = {
  active: '#10b981',
  canceled: '#f43f5e',
  incomplete_expired: '#fb923c',
  past_due: '#fbbf24',
  incomplete: '#94a3b8',
};
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** El orden de una temporada deportiva: septiembre primero, agosto último. */
const SEASON_MONTH_ORDER = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

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
function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('es-UY');
}
function monthLabel(ym: string): string {
  const [y, m] = ym.slice(0, 7).split('-');
  return `${MONTHS_ES[Number(m) - 1]} ${y.slice(2)}`;
}
/** La temporada a la que pertenece un mes: sep→ago, nombrada por su año inicial. */
function seasonOf(ym: string): number {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m >= 9 ? y : y - 1;
}
function seasonLabel(start: number): string {
  return `${String(start).slice(2)}/${String(start + 1).slice(2)}`;
}
function pct(cur: number, prev: number): { text: string; dir: 'up' | 'down' | 'flat' } {
  if (!prev) return { text: 'sin mes anterior', dir: 'flat' };
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 0.05) return { text: '0,0%', dir: 'flat' };
  return {
    text: `${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString('es-UY', { maximumFractionDigits: 1 })}%`,
    dir: d > 0 ? 'up' : 'down',
  };
}

type SeasonMetric = 'tx' | 'neto_usd' | 'bruto_local';
const SEASON_METRICS: { key: SeasonMetric; label: string }[] = [
  { key: 'tx', label: 'Transacciones' },
  { key: 'neto_usd', label: 'Ingresos netos (USD)' },
  { key: 'bruto_local', label: 'Ingresos brutos (moneda local)' },
];
/** Métricas que el prototipo ofrece y esta base todavía no puede calcular. */
const SEASON_METRICS_PENDING = [
  'Suscriptores activos (fin de mes)',
  'Bajas',
  'Transacciones nuevas / reactivadas / recurrentes',
];

export function FinancieroView() {
  const url = `/api/financiero/economia?${useFilterQS()}`;
  const { data, error, isLoading } = useSWR<EconomiaDTO>(url, fetcher);
  // El bruto vive en siete monedas de cobro que no se pueden sumar, así que la
  // pantalla muestra una por vez y arranca por la más grande del rango.
  const [grossCcy, setGrossCcy] = useState<string | null>(null);
  const [seasonMetric, setSeasonMetric] = useState<SeasonMetric>('tx');
  const [catFilters, setCatFilters] = useState({ market: 'ALL', season: 'ALL', plan: 'ALL', currency: 'ALL' });

  const currencies = useMemo(() => {
    if (!data) return [] as { currency: string; gross: number }[];
    const idx: Record<string, number> = {};
    for (const r of data.monthlyGross) idx[r.currency] = (idx[r.currency] ?? 0) + r.gross;
    return Object.entries(idx)
      .map(([currency, gross]) => ({ currency, gross }))
      .sort((a, b) => b.gross - a.gross);
  }, [data]);

  const activeCcy = grossCcy ?? currencies[0]?.currency ?? null;

  /** Transacciones y pagadores por mes, sumando todas las monedas: un conteo
   *  de eventos sí se puede sumar entre monedas, un importe no. */
  const txByMonth = useMemo(() => {
    if (!data) return [] as { month: string; tx: number; payers: number }[];
    const idx: Record<string, { tx: number; payers: number }> = {};
    for (const r of data.monthlyDetail) {
      idx[r.month.slice(0, 7)] ??= { tx: 0, payers: 0 };
      idx[r.month.slice(0, 7)].tx += r.txCount;
      idx[r.month.slice(0, 7)].payers += r.payers;
    }
    return Object.entries(idx)
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => (a.month < b.month ? -1 : 1));
  }, [data]);

  /** Neto en USD por mes, sumando plataformas y monedas ya convertidas. Un mes
   *  sin cotización no aporta: queda ausente, no en cero. */
  const netUsdByMonth = useMemo(() => {
    if (!data) return [] as { month: string; netUsd: number }[];
    const idx: Record<string, number> = {};
    for (const r of data.gateway.netUsdByMonth) {
      if (r.netUsd === null) continue;
      idx[r.month.slice(0, 7)] = (idx[r.month.slice(0, 7)] ?? 0) + r.netUsd;
    }
    return Object.entries(idx)
      .map(([month, netUsd]) => ({ month, netUsd }))
      .sort((a, b) => (a.month < b.month ? -1 : 1));
  }, [data]);

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
    return {
      labels: months.map((m) => m.slice(0, 7)),
      series: plats.map((p) => ({
        label: p,
        data: months.map((m) => idx[m]?.[p] ?? 0),
        color: PLATFORM_COLORS[p] ?? '#64748b',
      })),
    };
  }, [data, activeCcy]);

  const netMonthly = useMemo(() => {
    if (!data) return [] as { ccy: string; platformName: string; labels: string[]; series: { label: string; data: number[]; color: string }[] }[];
    const rows = data.gateway.netByMonth;
    return data.gateway.settlementTotals.map((t) => {
      // Cruzado por plataforma Y moneda: dos Proveedores liquidando la misma
      // moneda apilarían dos estructuras de comisión en una sola barra.
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
          // Sólo donde el Proveedor retiene. Apilar un cero plano se leería
          // como "lo miramos y no hay", que sólo es cierto para Stripe.
          ...(t.taxes > 0
            ? [{ label: `Retenciones ${t.settlementCurrency}`, data: mine.map((r) => r.taxes), color: '#f59e0b' }]
            : []),
        ],
      };
    });
  }, [data]);

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

  /** Neto diario por moneda de liquidación: el pulso de las comisiones. */
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

  /** Comisiones mes a mes por Proveedor·moneda, con su % efectivo sobre el
   *  bruto liquidado — nunca sobre el bruto de cobro, que está en otra moneda. */
  const feesCombo = useMemo(() => {
    if (!data) return { labels: [] as string[], bars: [] as { label: string; data: number[]; color: string }[], lines: [] as { label: string; data: number[]; color: string; dashed?: boolean }[] };
    const rows = data.gateway.netByMonth;
    const months = Array.from(new Set(rows.map((r) => r.month.slice(0, 7)))).sort();
    const keys = Array.from(new Set(rows.map((r) => `${r.platform}:${r.settlementCurrency}`)));
    const idx: Record<string, Record<string, { fees: number; taxes: number; gross: number }>> = {};
    for (const r of rows) {
      const k = `${r.platform}:${r.settlementCurrency}`;
      idx[k] ??= {};
      const cell = (idx[k][r.month.slice(0, 7)] ??= { fees: 0, taxes: 0, gross: 0 });
      cell.fees += r.fees;
      cell.taxes += r.taxes;
      cell.gross += r.grossSettlement;
    }
    const bars: { label: string; data: number[]; color: string }[] = [];
    const lines: { label: string; data: number[]; color: string; dashed?: boolean }[] = [];
    for (const k of keys) {
      const sample = rows.find((r) => `${r.platform}:${r.settlementCurrency}` === k)!;
      const name = `${sample.platformName} · ${sample.settlementCurrency}`;
      bars.push({
        label: `Comisión ${name}`,
        data: months.map((m) => idx[k]?.[m]?.fees ?? 0),
        color: CURRENCY_COLORS[sample.settlementCurrency] ?? '#94a3b8',
      });
      lines.push({
        label: `% efectivo ${name}`,
        data: months.map((m) => {
          const c = idx[k]?.[m];
          return c && c.gross > 0 ? Number(((c.fees / c.gross) * 100).toFixed(2)) : 0;
        }),
        color: '#f43f5e',
        dashed: true,
      });
    }
    return { labels: months, bars, lines };
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

  /** Suscripciones creadas y canceladas por mes. Stripe: es el único Proveedor
   *  con espejo de Suscripciones, y el churn se lee del `status`. */
  const subsMonthly = useMemo(() => {
    if (!data) return { labels: [] as string[], series: [] as { label: string; data: number[]; color: string }[] };
    const rows = [...data.gateway.subscriptionsByMonth].sort((a, b) => (a.month < b.month ? -1 : 1));
    return {
      labels: rows.map((r) => r.month.slice(0, 7)),
      series: [
        { label: 'Altas de suscripción', data: rows.map((r) => r.created), color: '#10b981' },
        { label: 'Cancelaciones', data: rows.map((r) => r.canceled), color: '#f43f5e' },
      ],
    };
  }, [data]);

  /** Temporadas deportivas (sep→ago): transacciones y neto USD por temporada. */
  const seasons = useMemo(() => {
    const idx: Record<number, { tx: number; netUsd: number }> = {};
    for (const r of txByMonth) {
      const s = seasonOf(r.month);
      (idx[s] ??= { tx: 0, netUsd: 0 }).tx += r.tx;
    }
    for (const r of netUsdByMonth) {
      const s = seasonOf(r.month);
      (idx[s] ??= { tx: 0, netUsd: 0 }).netUsd += r.netUsd;
    }
    return Object.entries(idx)
      .map(([start, v]) => ({ start: Number(start), label: seasonLabel(Number(start)), ...v }))
      .sort((a, b) => a.start - b.start);
  }, [txByMonth, netUsdByMonth]);

  /** Transacciones por frecuencia de plan y temporada. El catálogo tiene grano
   *  de temporada, no de mes: por eso el eje son temporadas y no meses como en
   *  el prototipo, que leía un CSV mensualizado que esta base no tiene. */
  const planFreqBySeason = useMemo(() => {
    if (!data) return { labels: [] as string[], series: [] as { label: string; data: number[]; color: string }[] };
    const rows = data.catalog.filter((r) => r.planFrequency);
    const seasonKeys = Array.from(new Set(rows.map((r) => r.season))).sort();
    const freqs = Array.from(new Set(rows.map((r) => r.planFrequency)));
    const idx: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      idx[r.season] ??= {};
      idx[r.season][r.planFrequency] = (idx[r.season][r.planFrequency] ?? 0) + r.txCount;
    }
    const COLORS: Record<string, string> = { Mensual: '#4f8ef7', Anual: '#a78bfa', Único: '#94a3b8' };
    return {
      labels: seasonKeys,
      series: freqs.map((f) => ({
        label: f,
        data: seasonKeys.map((s) => idx[s]?.[f] ?? 0),
        color: COLORS[f] ?? '#64748b',
      })),
    };
  }, [data]);

  /** La tabla mes × temporada del prototipo: filas sep→ago, columnas temporada. */
  const seasonTable = useMemo(() => {
    const value: Record<string, number> = {};
    if (seasonMetric === 'tx') for (const r of txByMonth) value[r.month] = r.tx;
    if (seasonMetric === 'neto_usd') for (const r of netUsdByMonth) value[r.month] = r.netUsd;
    if (seasonMetric === 'bruto_local' && data && activeCcy) {
      for (const r of data.monthlyDetail.filter((x) => x.currency === activeCcy)) {
        value[r.month.slice(0, 7)] = (value[r.month.slice(0, 7)] ?? 0) + r.gross;
      }
    }
    const seasonKeys = Array.from(new Set(Object.keys(value).map(seasonOf))).sort((a, b) => a - b);
    return {
      seasons: seasonKeys,
      rows: SEASON_MONTH_ORDER.map((m) => ({
        month: m,
        cells: seasonKeys.map((s) => {
          const year = m >= 9 ? s : s + 1;
          return value[`${year}-${String(m).padStart(2, '0')}`] ?? null;
        }),
      })),
      totals: seasonKeys.map((s) =>
        SEASON_MONTH_ORDER.reduce((acc, m) => {
          const year = m >= 9 ? s : s + 1;
          return acc + (value[`${year}-${String(m).padStart(2, '0')}`] ?? 0);
        }, 0),
      ),
    };
  }, [seasonMetric, txByMonth, netUsdByMonth, data, activeCcy]);

  /** Bruto y neto por mes y moneda de liquidación: la tabla "Ingresos mes a mes". */
  const revenueTable = useMemo(() => {
    if (!data) return { ccys: [] as string[], rows: [] as { month: string; byCcy: Record<string, { gross: number; net: number }>; netUsd: number | null }[] };
    const ccys = Array.from(new Set(data.gateway.netByMonth.map((r) => r.settlementCurrency))).sort();
    const idx: Record<string, Record<string, { gross: number; net: number }>> = {};
    for (const r of data.gateway.netByMonth) {
      const m = r.month.slice(0, 7);
      idx[m] ??= {};
      const cell = (idx[m][r.settlementCurrency] ??= { gross: 0, net: 0 });
      cell.gross += r.grossSettlement;
      cell.net += r.net;
    }
    const usd: Record<string, number> = {};
    for (const r of netUsdByMonth) usd[r.month] = r.netUsd;
    const months = Array.from(new Set([...Object.keys(idx), ...Object.keys(usd)])).sort().reverse();
    return {
      ccys,
      rows: months.map((month) => ({ month, byCcy: idx[month] ?? {}, netUsd: usd[month] ?? null })),
    };
  }, [data, netUsdByMonth]);

  /** El catálogo con los cinco selectores del prototipo. */
  const catalogView = useMemo(() => {
    if (!data) return { rows: [], markets: [], seasons: [], plans: [], ccys: [] } as {
      rows: EconomiaDTO['catalog'];
      markets: string[];
      seasons: string[];
      plans: string[];
      ccys: string[];
    };
    const all = data.catalog;
    const rows = all.filter(
      (r) =>
        (catFilters.market === 'ALL' || r.market === catFilters.market) &&
        (catFilters.season === 'ALL' || r.season === catFilters.season) &&
        (catFilters.plan === 'ALL' || `${r.planFamily} · ${r.planFrequency}` === catFilters.plan) &&
        (catFilters.currency === 'ALL' || r.currency === catFilters.currency),
    );
    return {
      rows,
      markets: Array.from(new Set(all.map((r) => r.market))).sort(),
      seasons: Array.from(new Set(all.map((r) => r.season))).sort(),
      plans: Array.from(new Set(all.map((r) => `${r.planFamily} · ${r.planFrequency}`))).sort(),
      ccys: Array.from(new Set(all.map((r) => r.currency))).sort(),
    };
  }, [data, catFilters]);

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
  const totalSubs = g.subscriptionsByStatus.reduce((s, r) => s + r.count, 0);
  const canceledStatus = g.subscriptionsByStatus.find((r) => r.status === 'canceled');
  const undatedCancels = canceledStatus ? canceledStatus.count - canceledStatus.withCanceledAt : 0;
  const detailByCcy = activeCcy ? data.monthlyDetail.filter((r) => r.currency === activeCcy) : [];
  const totalTaxes = g.settlementTotals.reduce((s, t) => s + t.taxes, 0);
  const taxCcy = g.settlementTotals.find((t) => t.taxes > 0);
  // Cobertura sólo sobre Pagos que *podían* traer comisión. Las preaprobaciones
  // de MercadoPago son objetos de suscripción que nunca tuvieron comisión, y
  // promediarlas dejaría la cifra clavada cerca del 73% como si fuera una
  // pérdida permanente.
  const payCoverage = g.coverage.reduce(
    (acc, r) => (r.idShape === 'preapproval'
      ? { ...acc, preapprovals: acc.preapprovals + r.successful }
      : { ...acc, withFee: acc.withFee + r.withFee, successful: acc.successful + r.successful }),
    { withFee: 0, successful: 0, preapprovals: 0 },
  );

  const curMonth = txByMonth.at(-1) ?? null;
  const prevMonth = txByMonth.at(-2) ?? null;
  const curUsd = netUsdByMonth.at(-1) ?? null;
  const prevUsd = netUsdByMonth.at(-2) ?? null;
  const txDelta = pct(curMonth?.tx ?? 0, prevMonth?.tx ?? 0);
  const usdDelta = pct(curUsd?.netUsd ?? 0, prevUsd?.netUsd ?? 0);

  const seasonFmt = (v: number | null): string => {
    if (v === null) return '—';
    if (seasonMetric === 'tx') return fmtNum(v);
    if (seasonMetric === 'neto_usd') return fmtRound(v, 'USD');
    return fmtRound(v, activeCcy ?? 'NONE');
  };

  return (
    <div>
      {/* ── Mes en curso vs mes anterior ── */}
      <SectionLabel>📅 Mes en curso vs mes anterior</SectionLabel>
      <div className="proto-ms-grid" style={{ marginBottom: 8 }}>
        <div className="proto-ms-col tx">
          <h4>
            Transacciones · {curMonth ? monthLabel(curMonth.month) : '—'}
            <InfoHint text="Cantidad de Pagos exitosos del último mes del rango, todos los Proveedores y monedas juntos: un conteo sí se puede sumar entre monedas. La variación compara contra el mes anterior." />
          </h4>
          <div className="proto-ms-big">{curMonth ? fmtNum(curMonth.tx) : '—'}</div>
          <div className={`proto-ms-delta ${txDelta.dir}`}>
            {txDelta.dir === 'up' ? '▲' : txDelta.dir === 'down' ? '▼' : '='} {txDelta.text}
            {prevMonth && <span style={{ color: 'var(--text3)', fontWeight: 500 }}>vs {fmtNum(prevMonth.tx)}</span>}
          </div>
          <div className="proto-ms-items">
            <div className="row">
              <span>Pagadores únicos</span>
              <span className="num">{curMonth ? fmtNum(curMonth.payers) : '—'}</span>
            </div>
            <div className="row">
              <span>Mes anterior</span>
              <span className="num">{prevMonth ? fmtNum(prevMonth.tx) : '—'}</span>
            </div>
          </div>
        </div>
        <div className="proto-ms-col active">
          <h4>Suscriptores activos</h4>
          <div className="proto-ms-big" style={{ fontSize: 18 }}>
            <span className="proto-tag">pendiente</span>
          </div>
          <div className="proto-ms-items">
            <div className="row">
              <span>
                El activo del mes se cuenta sobre Suscripciones, que todavía no tiene
                tabla para MercadoPago.
              </span>
            </div>
          </div>
        </div>
        <div className="proto-ms-col revenue">
          <h4>
            Ingresos netos USD · {curUsd ? monthLabel(curUsd.month) : '—'}
            <InfoHint text="Neto del último mes en el plano de liquidación: bruto liquidado menos comisión y retención, convertido a USD con la cotización de cada día (ARS al blue venta). Sin PayPal, que no tiene feed de comisiones." />
          </h4>
          <div className="proto-ms-big">{curUsd ? fmtRound(curUsd.netUsd, 'USD') : '—'}</div>
          <div className={`proto-ms-delta ${usdDelta.dir}`}>
            {usdDelta.dir === 'up' ? '▲' : usdDelta.dir === 'down' ? '▼' : '='} {usdDelta.text}
            {prevUsd && (
              <span style={{ color: 'var(--text3)', fontWeight: 500 }}>vs {fmtRound(prevUsd.netUsd, 'USD')}</span>
            )}
          </div>
          <div className="proto-ms-items">
            <div className="row">
              <span>Plano de liquidación, convertido día por día</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPIs ── */}
      <SectionLabel>👥 Suscriptores y transacciones</SectionLabel>
      <div className="proto-kpis">
        <KpiCard
          label="Transacciones en rango"
          value={totalTx}
          variant="blue"
          hint="Pagos exitosos con Subscriber conocido dentro del rango y los filtros, sumando todos los Proveedores y monedas. Cuenta eventos de pago, no personas ni importes."
        />
        <KpiCard
          label="Transacciones del último mes"
          value={curMonth ? curMonth.tx : '—'}
          sub={curMonth ? monthLabel(curMonth.month) : undefined}
          hint="Pagos exitosos del último mes con datos en el rango, todos los Proveedores. El mes se asigna por la fecha del Pago (hora de Argentina), no por captured_at."
        />
        <KpiCard
          label={`Suscripciones activas · ${g.subscriptionPlatformName}`}
          value={activeSubs}
          sub={`${totalSubs.toLocaleString()} en total · sin MercadoPago`}
          variant="yellow"
          hint="Subscriptions de Stripe con status «active» hoy, según su espejo. Es una foto actual: no respeta el rango ni los filtros, y MercadoPago no entra porque sus Subscriptions no tienen tabla."
        />
        <KpiCard
          label="Suscriptores activos totales"
          value="pendiente"
          sub="espera el Export de planes de suscripción de MercadoPago"
          hint="Se contará como Subscribers únicos con Subscription vigente al cierre del mes, en todos los Proveedores. Hoy sólo Stripe tiene espejo de Subscriptions, así que el número no existe."
        />
      </div>

      <SectionLabel>💰 Ingresos y costes</SectionLabel>
      <div className="proto-kpis">
        <KpiCard
          label={`Bruto ${topCcy?.currency ?? '—'} · cobro`}
          value={topCcy ? fmtRound(topCcy.gross, topCcy.currency) : '—'}
          sub={`moneda más grande del rango · ${currencies.length} monedas en total`}
          hint="Suma de lo facturado al Subscriber en esa moneda (plano de cobro) sobre los Pagos exitosos del rango, sin descontar comisiones. Se muestra la moneda con mayor bruto; las demás no se suman."
        />
        <KpiCard
          label={`Neto ${usd?.settlementCurrency ?? 'USD'} · liquidación ${g.platformName}`}
          value={usd ? fmtExact(usd.net, usd.settlementCurrency) : '—'}
          sub={usd ? `comisión ${fmtExact(usd.fees, usd.settlementCurrency)} · ${usd.feePct}% · ${usd.txCount.toLocaleString()} tx` : 'sin comisiones en rango'}
          variant="green"
          hint="Sólo lo liquidado en USD (hoy Stripe): bruto liquidado menos comisión y retención según el feed de comisiones, bucketeado por captured_at. El % es comisión ÷ bruto liquidado, no sobre el bruto de cobro."
        />
        <KpiCard
          label="Neto USD del último mes"
          value={curUsd ? fmtRound(curUsd.netUsd, 'USD') : '—'}
          sub={curUsd ? `${monthLabel(curUsd.month)} · convertido día por día` : undefined}
          variant="green"
          hint="Neto de liquidación del último mes convertible, sumando Proveedores y monedas ya pasadas a USD con la cotización de cada día. Un mes con algún día sin cotización queda ausente, no en cero."
        />
        <KpiCard
          label={`Retenciones ${taxCcy?.settlementCurrency ?? ''}`.trim()}
          value={taxCcy ? fmtRound(totalTaxes, taxCcy.settlementCurrency) : '—'}
          sub="impuesto retenido en la fuente: vuelve como crédito fiscal, no es comisión"
          variant="red"
          hint="Impuesto que el Proveedor retiene en la fuente sobre el bruto liquidado en el rango (MercadoPago, en ARS). No es comisión: vuelve como crédito fiscal, y por eso se muestra aparte del neto."
        />
      </div>

      {/* ── Vista consolidada ── */}
      <div style={{ marginTop: 18 }} />
      <Card
        title="📈 Vista consolidada: ingresos, activos y transacciones"
        hint="Neto de liquidación por mes convertido a USD día por día, contra la cantidad de Pagos exitosos de ese mes. Las dos series usan relojes distintos: captured_at y fecha del Pago."
        desc={
          <>
            Barras: <b>ingresos netos en USD</b> por mes (eje izquierdo). Línea:{' '}
            <b>número de transacciones</b> (eje derecho). Permite ver de un vistazo si los
            ingresos crecen en línea con el volumen transaccional. La tercera serie del
            prototipo — <b>suscriptores activos reales</b> — todavía no se puede dibujar:
            depende de Suscripciones.
          </>
        }
        foot="El neto sale del plano de liquidación y se convierte día por día; las transacciones se cuentan sobre los Pagos ingestados."
      >
        {netUsdByMonth.length === 0 ? (
          <div className="no-data">Sin ingresos convertibles en rango</div>
        ) : (
          <ComboChart
            height={360}
            labels={netUsdByMonth.map((r) => monthLabel(r.month))}
            tooltipTitles={bucketTitles(netUsdByMonth.map((r) => `${r.month}-01`), 'month')}
            bars={[{ label: 'Ingresos netos USD', data: netUsdByMonth.map((r) => r.netUsd), color: '#10b981' }]}
            lines={[
              {
                label: 'Transacciones',
                data: netUsdByMonth.map((r) => txByMonth.find((t) => t.month === r.month)?.tx ?? 0),
                color: '#4f8ef7',
              },
            ]}
            barAxisTitle="USD netos"
            lineAxisTitle="Transacciones"
          />
        )}
        <div style={{ marginTop: 12 }}>
          <Pending kind="suscripciones">
            Falta la línea de <strong>suscriptores activos reales</strong>: se cuenta como
            emails únicos con suscripción vigente al cierre del mes, y hoy sólo Stripe
            tiene espejo de Suscripciones.
          </Pending>
        </div>
      </Card>

      {/* ── Últimos 15 días ── */}
      <Card
        title="📅 Últimos 15 días — altas, reactivados, bajas y suscripciones netas (por día)"
        desc={
          <>
            Barras verdes (<b>altas nuevas</b>): emails que pagan por primera vez.
            Naranjas (<b>reactivados</b>): emails que ya pagaron antes, salieron del pool y
            vuelven. Rojas (<b>bajas</b>): emails que estaban activos ayer y hoy ya no.
            Línea azul (<b>netas</b>) = altas + reactivados − bajas.
          </>
        }
      >
        <Pending kind="suscripciones" />
      </Card>

      <Card
        title="👥 Últimos 15 días — suscriptores activos vigentes"
        desc="Snapshot diario de suscriptores activos: mensuales con último pago dentro de los últimos 60–75 días, anuales dentro de su ciclo de 365 días."
      >
        <Pending kind="suscripciones" />
      </Card>

      {/* ── Real vs Plan ── */}
      <Card
        title="📊 Mes en curso — Real vs Plan vs Mes Anterior"
        desc={
          <>
            Día por día del mes en curso, por Proveedor y en moneda nativa:{' '}
            <b>Real</b> = ingresos netos cobrados; <b>Plan</b> = lo que se preveía
            facturar; <b>Real Mes Anterior</b> = lo facturado el mismo día del mes pasado.
          </>
        }
      >
        <Pending kind="plan" />
      </Card>

      {/* ── Transacciones mensuales · Mix de planes ── */}
      <div className="proto-grid2">
        <Card
          title="Transacciones mensuales"
          desc="Altas, recurrentes, reactivaciones y bajas mes a mes, con las cancelaciones oficiales de cada Proveedor."
        >
          <Pending kind="suscripciones">
            Los cuatro buckets (nuevo · recurrente · reactivado · baja) se calculan sobre el
            ciclo de vida del suscriptor, que hoy sólo existe con grano de mes y sin corte
            por país ni plan. Mientras tanto, el total de transacciones por mes está en la
            vista consolidada de arriba.
          </Pending>
        </Card>
        <Card
          title="Mix de planes"
          hint="Reparto de los Pagos exitosos del rango por Tier y frecuencia (Básico/Total · Mensual/Anual/Free), inferidos de recurrent y price_id. Cuenta Pagos, no importes ni Subscribers."
          desc="Distribución de transacciones por tipo de suscripción, en todo el rango."
        >
          <div style={{ height: 260 }}>
            {planMix.length === 0 ? (
              <div className="no-data">Sin datos</div>
            ) : (
              <DoughnutChart
                height={260}
                labels={planMix.map((p) => p.label)}
                values={planMix.map((p) => p.txCount)}
              />
            )}
          </div>
          <div className="proto-foot">
            Conteo de transacciones, no importe: es la única métrica de esta pantalla que se
            puede sumar entre monedas.
          </div>
        </Card>
      </div>

      {/* ── Cancelaciones · antigüedad del último cargo ── */}
      <div className="proto-grid2">
        <Card
          title={`📉 Altas y cancelaciones de suscripción por mes · ${g.subscriptionPlatformName}`}
          hint="Subscriptions de Stripe creadas (por created_at) y canceladas (por canceled_at) en cada mes del rango. Sólo las cancelaciones con fecha entran al gráfico; el total por status está más abajo."
          desc={
            <>
              Eventos oficiales del Proveedor, con su fecha real. El churn se lee del{' '}
              <code>status</code> y no de <code>canceled_at</code>: {undatedCancels.toLocaleString()} de{' '}
              {(canceledStatus?.count ?? 0).toLocaleString()} cancelaciones no traen fecha, y
              bucketear por ella las dejaría afuera.
            </>
          }
          foot={
            g.subscriptionsIgnoreFilters
              ? 'Sin MercadoPago: sus Suscripciones viven en un Export que todavía no tiene tabla. No afectado por los filtros.'
              : 'Sin MercadoPago: sus Suscripciones viven en un Export que todavía no tiene tabla.'
          }
        >
          <div style={{ height: 300 }}>
            {subsMonthly.labels.length === 0 ? (
              <div className="no-data">Sin suscripciones en rango</div>
            ) : (
              <StackedBarChart
                height={300}
                labels={subsMonthly.labels}
                tooltipTitles={bucketTitles(subsMonthly.labels, 'month')}
                series={subsMonthly.series}
              />
            )}
          </div>
        </Card>
        <Card
          title="📅 Suscriptores activos por antigüedad del último cargo"
          desc="Distribución de suscriptores activos según cuándo fue su último cobro: ideal 0–30 días. Las bandas viejas (61+) son zombies o subs en mora, y anticipan churn."
        >
          <Pending kind="suscripciones" />
        </Card>
      </div>

      {/* ── Vida media ── */}
      <Card
        title="⏱️ Promedio de vida de un suscriptor"
        desc="Meses promedio que un suscriptor se mantuvo activo, sumando reactivaciones. Sólo promedia clientes cerrados, para no inflar con ciclos aún abiertos."
      >
        <Pending kind="suscripciones" />
      </Card>

      {/* ── Ingresos netos por mes · activos reales ── */}
      <div className="proto-grid2">
        <Card
          title="Ingresos netos por mes"
          hint="Por Proveedor y moneda de liquidación, mes a mes por captured_at: neto, comisión y, donde existe, retención; apiladas suman el bruto liquidado. Fuente: el feed de comisiones de cada Proveedor."
          desc={
            <>
              Ingresos <b>netos</b> por Proveedor y moneda de liquidación: bruto liquidado
              menos comisión, y menos retención donde el Proveedor retiene. Una tarjeta por
              moneda, porque apilar dos monedas no da un total.
            </>
          }
          foot="Plano de liquidación: lo que el Proveedor movió, no lo que se facturó. La comisión se gasta; la retención vuelve como crédito fiscal, y por eso va aparte."
        >
          {netMonthly.length === 0 ? (
            <div className="no-data">Sin datos de liquidación en rango</div>
          ) : (
            netMonthly.map((c) => (
              <div key={`${c.platformName}:${c.ccy}`} style={{ marginBottom: 14 }}>
                <div className="proto-note" style={{ marginBottom: 6 }}>
                  {c.platformName} · {c.ccy}
                </div>
                <div style={{ height: 200 }}>
                  {c.labels.length === 0 ? (
                    <div className="no-data">Sin datos</div>
                  ) : (
                    <StackedBarChart
                      height={200}
                      labels={c.labels}
                      tooltipTitles={bucketTitles(c.labels, 'month')}
                      series={c.series}
                    />
                  )}
                </div>
              </div>
            ))
          )}
        </Card>
        <Card
          title="Suscriptores activos reales"
          desc="Emails únicos con una suscripción vigente al cierre de cada mes: cada persona cuenta una sola vez por mes aunque tenga varias transacciones."
        >
          <Pending kind="suscripciones" />
        </Card>
      </div>

      {/* ── USD, con la cotización a la vista ── */}
      <Card
        title="💵 Ingresos netos en USD · convertidos día por día"
        hint="Neto de liquidación pasado a USD con la cotización de cada día: ARS al blue venta de dolarapi, lo ya liquidado en USD sin convertir. Un mes con algún día sin cotización no se dibuja."
        desc={
          <>
            Una línea por Proveedor y moneda de liquidación. Un mes sin cotización rompe la
            línea en vez de dibujar un cero: el sentido de la tabla de FX es que una
            cotización que falta se vea faltando.
          </>
        }
        foot={
          <>
            Plano de <strong>liquidación</strong> convertido a USD <strong>por día</strong>,
            nunca al tipo de cambio de hoy ni al promedio del mes: con la inflación
            argentina, convertir un Pago de 2024 a la cotización actual no es un redondeo,
            es otro número. ARS usa el <strong>blue venta</strong> de dolarapi; lo ya
            liquidado en USD no se convierte. Una moneda que ninguna fuente cotiza — hoy EUR
            — queda <strong>ausente</strong>, no en cero.
          </>
        }
      >
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
      </Card>

      {/* ── Temporadas ── */}
      <div className="proto-grid2">
        <Card
          title="🏆 Comparativa por temporadas deportivas"
          hint="Pagos exitosos y neto USD (liquidación, convertido por día) agrupados por temporada deportiva, del 1 de septiembre al 31 de agosto. La temporada en curso está incompleta y se compara contra temporadas enteras."
          desc={
            <>
              Cada temporada va del <b>1 de septiembre</b> al <b>31 de agosto</b> del año
              siguiente. Se comparan transacciones e ingresos netos en USD. La tercera serie
              del prototipo — suscriptores activos, pico mensual de la temporada — depende de
              Suscripciones y no se dibuja.
            </>
          }
          foot="La temporada en curso compara una parte del año contra temporadas completas: mírala como parcial, no como caída."
        >
          <div style={{ height: 300 }}>
            {seasons.length === 0 ? (
              <div className="no-data">Sin datos</div>
            ) : (
              <ComboChart
                height={300}
                labels={seasons.map((s) => s.label)}
                bars={[{ label: 'Ingresos netos USD', data: seasons.map((s) => s.netUsd), color: '#10b981' }]}
                lines={[{ label: 'Transacciones', data: seasons.map((s) => s.tx), color: '#4f8ef7' }]}
                barAxisTitle="USD netos"
                lineAxisTitle="Transacciones"
              />
            )}
          </div>
        </Card>
        <Card
          title="📊 Transacciones por plan · Mensual vs Anual"
          hint="Pagos exitosos por frecuencia de Tier (Mensual, Anual, Free) y temporada sep→ago, según el Period de cada Pago. Es un conteo de Pagos, no de Subscribers."
          desc={
            <>
              Transacciones de suscripción por frecuencia de plan. El eje son{' '}
              <b>temporadas</b> y no meses: el catálogo se deriva con grano de temporada, y
              mensualizarlo pediría un corte plan×mes que la base todavía no tiene.
            </>
          }
        >
          <div style={{ height: 300 }}>
            {planFreqBySeason.labels.length === 0 ? (
              <div className="no-data">Sin datos</div>
            ) : (
              <StackedBarChart
                height={300}
                labels={planFreqBySeason.labels}
                series={planFreqBySeason.series}
              />
            )}
          </div>
        </Card>
      </div>

      {/* ── Tabla mes × temporada ── */}
      <Card
        title="📅 Comparativa mensual por temporadas"
        hint="Cada celda es el valor del mes en la métrica elegida: Pagos exitosos, neto USD (liquidación, convertido por día) o bruto de cobro en una moneda. Las columnas son temporadas sep→ago y el Total suma la columna."
        desc={
          <>
            Cada columna es una temporada deportiva (sep→ago) y cada fila un mes en orden de
            temporada. El <b>% incremento</b> compara cada celda con el mes inmediatamente
            anterior en el tiempo: octubre contra septiembre de la misma temporada,
            septiembre contra agosto de la anterior.
          </>
        }
        foot={
          <>
            Métricas del prototipo que todavía no se pueden calcular:{' '}
            {SEASON_METRICS_PENDING.join(' · ')} — todas dependen de Suscripciones.
          </>
        }
      >
        <div className="proto-controls">
          <label>
            Métrica a comparar
            <select value={seasonMetric} onChange={(e) => setSeasonMetric(e.target.value as SeasonMetric)}>
              {SEASON_METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
              {SEASON_METRICS_PENDING.map((m) => (
                <option key={m} value={m} disabled>
                  {m} · pendiente
                </option>
              ))}
            </select>
          </label>
          {seasonMetric === 'bruto_local' && (
            <label>
              Moneda
              <select value={activeCcy ?? ''} onChange={(e) => setGrossCcy(e.target.value)}>
                {currencies.map((c) => (
                  <option key={c.currency} value={c.currency}>
                    {c.currency}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="table-scroll" style={{ maxHeight: 520, overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Mes</th>
                {seasonTable.seasons.map((s) => (
                  <th key={s} style={{ textAlign: 'right' }}>
                    {seasonLabel(s)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seasonTable.rows.map((r) => (
                <tr key={r.month}>
                  <td>{MONTHS_ES[r.month - 1]}</td>
                  {r.cells.map((v, i) => (
                    <td key={i} style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
                      {seasonFmt(v)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="row-active">
                <td style={{ fontWeight: 600 }}>Total</td>
                {seasonTable.totals.map((v, i) => (
                  <td key={i} style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'DM Mono, monospace' }}>
                    {seasonFmt(v)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Comisiones ── */}
      <Card
        title="💳 Comisiones de pasarela"
        hint="Comisión del Proveedor por mes (por captured_at) en su moneda de liquidación, sin retenciones. El % efectivo es comisión ÷ bruto liquidado del mismo Proveedor y moneda."
        desc={
          <>
            Comisiones cobradas por cada Proveedor mes a mes (barras) y el{' '}
            <b>% efectivo</b> sobre su propio bruto liquidado (línea punteada, eje derecho).
            Las barras no se apilan: cada una está en su moneda.
          </>
        }
        foot={
          <>
            {g.platformName}: {payCoverage.withFee.toLocaleString()} de{' '}
            {payCoverage.successful.toLocaleString()} Pagos con id de Proveedor traen comisión.
            {payCoverage.preapprovals > 0 && (
              <> Quedan afuera {payCoverage.preapprovals.toLocaleString()} preaprobaciones de
              MercadoPago: son suscripciones, no cobros, y nunca tuvieron comisión que informar.</>
            )}{' '}
            El % se calcula contra <code>settlement_amount</code> y no contra el bruto de
            cobro: dividir una comisión en USD por un bruto en UYU da 0,16% y no significa
            nada.
          </>
        }
      >
        <div style={{ height: 320 }}>
          {feesCombo.labels.length === 0 ? (
            <div className="no-data">Sin comisiones en rango</div>
          ) : (
            <ComboChart
              height={320}
              labels={feesCombo.labels.map(monthLabel)}
              tooltipTitles={bucketTitles(feesCombo.labels.map((m) => `${m}-01`), 'month')}
              bars={feesCombo.bars}
              lines={feesCombo.lines}
              barAxisTitle="Comisión (moneda de liquidación)"
              lineAxisTitle="% efectivo"
            />
          )}
        </div>
      </Card>

      <Card
        title="💳 Neto diario por moneda de liquidación"
        hint="Neto de liquidación por día y moneda: bruto liquidado menos comisión y retención, sumando los Proveedores que liquidan en esa moneda. Bucketeado por captured_at, UTC real."
        desc="El pulso de las comisiones día por día. Bucketeado por captured_at (UTC real), no por la fecha del Pago (hora local de Argentina): los dos relojes están a 3 horas."
        foot={
          g.netExcludesUnmatchedFees
            ? 'Con filtros activos sólo entran las comisiones cuyo Pago está ingestado; el titular sin filtros lee el espejo completo.'
            : undefined
        }
      >
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
      </Card>

      {/* ── Ingresos mes a mes ── */}
      <Card
        title="Ingresos mes a mes"
        hint="Bruto y neto de liquidación por mes y moneda según el feed de comisiones; NETO USD es la suma de esos netos convertidos día por día. Las barras, en cambio, son el bruto de cobro en la moneda elegida."
        desc={
          <>
            Bruto vs neto por mes y por moneda de liquidación. Bruto = lo que el Proveedor
            movió; neto = lo que quedó después de comisión y retención. La última columna es
            el total convertido a USD día por día.
          </>
        }
        foot={
          data.grossOnlyPlatforms.length > 0 ? (
            <>
              {data.grossOnlyPlatforms.join(', ')} no aparece
              {data.grossOnlyPlatforms.length > 1 ? 'n' : ''} en esta tabla: no tenemos su feed
              de comisiones, y contarlo con comisión cero lo haría parecer gratis.
            </>
          ) : undefined
        }
      >
        <div className="proto-controls">
          <label>
            Moneda del gráfico de bruto
            <select value={activeCcy ?? ''} onChange={(e) => setGrossCcy(e.target.value)}>
              {currencies.map((c) => (
                <option key={c.currency} value={c.currency}>
                  {c.currency}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ height: 260, marginBottom: 14 }}>
          {grossMonthly.labels.length === 0 ? (
            <div className="no-data">Sin ingresos en rango</div>
          ) : (
            <StackedBarChart
              height={260}
              labels={grossMonthly.labels}
              tooltipTitles={bucketTitles(grossMonthly.labels, 'month')}
              series={grossMonthly.series}
            />
          )}
        </div>
        <div className="proto-foot" style={{ marginBottom: 14 }}>
          Barras: bruto de <strong>cobro</strong> en {activeCcy}, apilado por plataforma —
          una moneda por vez, porque apilar monedas distintas no daría un total.
        </div>
        <div className="table-scroll" style={{ maxHeight: 420, overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Mes</th>
                {revenueTable.ccys.map((c) => (
                  <th key={`g-${c}`} style={{ textAlign: 'right' }}>
                    Bruto {c}
                  </th>
                ))}
                {revenueTable.ccys.map((c) => (
                  <th key={`n-${c}`} style={{ textAlign: 'right' }}>
                    Neto {c}
                  </th>
                ))}
                <th style={{ textAlign: 'right' }}>NETO USD</th>
              </tr>
            </thead>
            <tbody>
              {revenueTable.rows.map((r) => (
                <tr key={r.month}>
                  <td>{monthLabel(r.month)}</td>
                  {revenueTable.ccys.map((c) => (
                    <td key={`g-${c}`} style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
                      {r.byCcy[c] ? fmtRound(r.byCcy[c].gross, c) : '—'}
                    </td>
                  ))}
                  {revenueTable.ccys.map((c) => (
                    <td key={`n-${c}`} style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
                      {r.byCcy[c] ? fmtRound(r.byCcy[c].net, c) : '—'}
                    </td>
                  ))}
                  <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace', color: 'var(--green)' }}>
                    {r.netUsd === null ? '—' : fmtRound(r.netUsd, 'USD')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Detalle mensual ── */}
      <Card
        title={`Detalle mensual · ${activeCcy ?? '—'}`}
        hint="Por mes, sobre los Pagos exitosos en la moneda elegida: bruto de cobro, cantidad de Pagos y Subscribers distintos. La columna Neto USD es el total del mes en liquidación, con todas las monedas."
        desc={
          <>
            Las columnas de <i>transacciones</i> son eventos de pago: un mismo email puede
            aparecer varias veces en el mes. Las columnas de <i>suscriptores activos únicos</i>{' '}
            del prototipo — mensuales, anuales y su suma — dependen de Suscripciones y no
            están.
          </>
        }
        foot="Más reciente arriba. El corte por bucket (nuevos · recurrentes · reactivados · bajas · partido único) llega con Suscripciones."
      >
        <div className="table-scroll" style={{ maxHeight: 480, overflow: 'auto' }}>
          {detailByCcy.length === 0 ? (
            <div className="no-data">Sin datos</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th style={{ textAlign: 'right' }}>Bruto {activeCcy}</th>
                  <th style={{ textAlign: 'right' }}>Transacciones</th>
                  <th style={{ textAlign: 'right' }}>Pagadores</th>
                  <th style={{ textAlign: 'right' }}>Neto USD</th>
                </tr>
              </thead>
              <tbody>
                {[...detailByCcy].reverse().map((r) => {
                  const m = r.month.slice(0, 7);
                  const netUsd = netUsdByMonth.find((x) => x.month === m)?.netUsd ?? null;
                  return (
                    <tr key={r.month}>
                      <td>{monthLabel(m)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
                        {fmtRound(r.gross, r.currency)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{r.txCount.toLocaleString()}</td>
                      <td style={{ textAlign: 'right', color: 'var(--green)' }}>
                        {r.payers.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
                        {netUsd === null ? '—' : fmtRound(netUsd, 'USD')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* ── Ingresos por país ── */}
      <div className="proto-grid2">
        <Card
          title="🌎 Ingresos por país · plano de cobro"
          hint="Bruto de cobro, Pagos exitosos y Subscribers distintos por país del Subscriber (no del contenido) y moneda, en el rango. «N/A» es un Subscriber sin país; nada se convierte ni se suma entre monedas."
          desc="Una fila por país y moneda; sin fila de total, porque sumar ARS con UYU no da un número."
          foot={`Top 40 de ${data.byCountry.length} filas.`}
        >
          <div className="table-scroll" style={{ maxHeight: 340, overflow: 'auto' }}>
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
        </Card>
        <Card
          title={`Suscripciones por estado · ${g.subscriptionPlatformName}`}
          hint="Cuántas Subscriptions de Stripe hay hoy en cada status del espejo (active, canceled, past_due…). Foto actual, no ventana: ignora el rango y los filtros."
          desc="Estado actual, en el vocabulario del Proveedor."
          foot={
            <>
              El churn se lee del <code>status</code>: {undatedCancels.toLocaleString()} de{' '}
              {(canceledStatus?.count ?? 0).toLocaleString()} cancelaciones no traen fecha.
              {g.subscriptionsIgnoreFilters && <> No afectado por los filtros.</>}
            </>
          }
        >
          <div style={{ height: 260 }}>
            {g.subscriptionsByStatus.length === 0 ? (
              <div className="no-data">Sin suscripciones</div>
            ) : (
              <DoughnutChart
                height={260}
                labels={g.subscriptionsByStatus.map((r) => r.status)}
                values={g.subscriptionsByStatus.map((r) => r.count)}
                colors={g.subscriptionsByStatus.map((r) => STATUS_COLORS[r.status] ?? '#64748b')}
              />
            )}
          </div>
        </Card>
      </div>

      {/* ── Catálogo ── */}
      <Card
        title="🏷️ Catálogo de precios inferido por plan, mercado y temporada"
        hint="Precios distintos que realmente pagaron los Subscribers, por Tier, frecuencia, país, moneda y temporada, con cuántos Pagos exitosos cayeron en cada uno. Sale de los Pagos, no de una lista de precios."
        desc={
          <>
            <b>Precios detectados directamente desde las transacciones.</b> Si aparecen
            varios precios en el mismo plan, mercado y temporada, puede ser un cambio de
            tarifa, un descuento o un error de catálogo. Un punto de precio que nadie pagó no
            aparece; uno que cambió a mitad de temporada aparece dos veces.
          </>
        }
        foot={`Temporada deportiva sep→ago. ${catalogView.rows.length.toLocaleString()} combinaciones tras los filtros, de ${data.catalog.length.toLocaleString()} en rango; se listan las primeras 80.`}
      >
        <div className="proto-controls">
          <label>
            Mercado
            <select
              value={catFilters.market}
              onChange={(e) => setCatFilters({ ...catFilters, market: e.target.value })}
            >
              <option value="ALL">Todos</option>
              {catalogView.markets.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            Temporada
            <select
              value={catFilters.season}
              onChange={(e) => setCatFilters({ ...catFilters, season: e.target.value })}
            >
              <option value="ALL">Todas</option>
              {catalogView.seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Plan
            <select
              value={catFilters.plan}
              onChange={(e) => setCatFilters({ ...catFilters, plan: e.target.value })}
            >
              <option value="ALL">Todos</option>
              {catalogView.plans.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            Moneda
            <select
              value={catFilters.currency}
              onChange={(e) => setCatFilters({ ...catFilters, currency: e.target.value })}
            >
              <option value="ALL">Todas</option>
              {catalogView.ccys.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-scroll" style={{ maxHeight: 520, overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Frecuencia</th>
                <th>Mercado</th>
                <th>Temporada</th>
                <th>Moneda</th>
                <th style={{ textAlign: 'right' }}>Precio</th>
                <th style={{ textAlign: 'right' }}>Transacciones</th>
              </tr>
            </thead>
            <tbody>
              {catalogView.rows.slice(0, 80).map((r) => (
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
      </Card>

      {/* ── Asistente ── */}
      <Card
        title="💬 Asistente de datos"
        desc="Preguntas sobre los datos del dashboard en lenguaje natural: ingresos por Proveedor y moneda, activos, transacciones, comisiones, precios."
      >
        {/* El plan y su orden viven en docs/handoff/financiero-dashboard-port.md,
            paso 6; acá va sólo el porqué, que es lo único que le sirve a quien
            mira la pantalla. */}
        <Pending kind="asistente">
          El asistente del prototipo respondía sobre una copia de los datos embebida y
          congelada. Contra la base viva necesita una superficie de consulta propia, y cada
          número que citaría sale de los bloques de arriba: es lo último de la portación, no
          lo primero.
        </Pending>
      </Card>

      {/* ── Notas metodológicas ── */}
      <details className="proto-card">
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
          Notas metodológicas
        </summary>
        <div className="proto-desc" style={{ marginTop: 12 }}>
          <p style={{ marginBottom: 8 }}>
            <b>Dos planos.</b> El de <b>cobro</b> es lo que se le facturó al suscriptor, en
            su moneda; el de <b>liquidación</b> es lo que el Proveedor movió, en la moneda de
            la cuenta. Toda la aritmética de esta pantalla ocurre dentro de un plano.
            Dividir una comisión en USD por un bruto en UYU da 0,16% y no significa nada.
          </p>
          <p style={{ marginBottom: 8 }}>
            <b>Comisión y retención no son lo mismo.</b> MercadoPago descuenta las dos y su
            Export nombra sólo la primera: la comisión es 1,80% y el neto queda 7,31% abajo
            del bruto. La diferencia es impuesto retenido en la fuente. Sumarlas y llamar al
            resultado &quot;comisión&quot; haría parecer a MercadoPago cuatro veces más caro
            que Stripe cuando en realidad es más barato.
          </p>
          <p style={{ marginBottom: 8 }}>
            <b>Conversión a USD, por día.</b> El blue se movió 9,5% dentro de julio de 2024 y
            de 1.000 a 1.565 en el período que cubren los Pagos: una cotización mensual no es
            un redondeo de la diaria. Stripe convierte con su propio{' '}
            <code>exchange_rate</code>; ARS con el blue venta de dolarapi. EUR no lo cotiza
            ninguna fuente y sus figuras USD quedan ausentes.
          </p>
          <p style={{ marginBottom: 8 }}>
            <b>Dos relojes.</b> <code>basket_payments.created_at</code> es hora de Argentina
            guardada como UTC; <code>captured_at</code> es UTC real. Son 3 horas, y sólo
            importan en los bordes de mes.
          </p>
          <p>
            <b>PayPal es sólo bruto.</b> 90 Suscripciones y ningún feed de comisiones:
            aparece en el bruto y se lo declara excluido de toda cifra neta, en vez de
            contarlo como si no costara nada.
          </p>
        </div>
      </details>
    </div>
  );
}
