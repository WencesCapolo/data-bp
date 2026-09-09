'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { useFilterQS, useFilters } from '@/lib/client/filterStore';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import { Breakdown, Card, Kpi, MsCol, Pending, SectionLabel, delta } from './financiero/blocks';
import {
  ActiveChart,
  CancelMonthlyChart,
  CombinedChart,
  Daily15Chart,
  DailyActive15Chart,
  FeesChart,
  FlowChart,
  LC_BUCKETS,
  LastChargeChart,
  PlansDonut,
  PlansFreqChart,
  RevenueChart,
  SeasonsChart,
} from './financiero/protoCharts';
import {
  fmt,
  fmtDayShort,
  fmtUsd,
  fmtUsdRound,
  monthToSeason,
  pctOf,
  seasonFullRange,
  seasonLabel,
  ym,
} from './financiero/format';
import type { EconomiaDTO } from '@basket/core/dtos/EconomiaDTO';
import type { MonthlyLifecyclePoint, ActiveByMonthPoint } from '@basket/core/dtos/SubscriberLifecycleDTO';

/**
 * La vista Suscriptores de /financiero: `public/dashboard.html`, tarjeta por
 * tarjeta y en su orden, con los números vivos.
 *
 * Snapshot de 30 días, dos filas de KPIs con desglose, la vista consolidada,
 * los dos gráficos de 15 días, Real vs Plan, flujo mensual y mix de planes,
 * cancelaciones y antigüedad del último cargo, vida media, ingresos netos y
 * activos reales, temporadas, la tabla mes × temporada, comisiones, las dos
 * tablas mensuales y el catálogo. Lo único agregado es el "?" de cada título.
 *
 * Nada de lo que se dibuja acá suma monedas distintas sin pasar por USD. El
 * bruto vive en el plano de **cobro** y en siete monedas; el neto vive en el
 * plano de **liquidación** y se convierte a USD día por día. Son dos números
 * diferentes de la misma venta.
 */

const GW_COLOR: Record<string, string> = { MercadoPago: '#06b6d4', Stripe: '#635bff', PayPal: '#003087' };
const CUR_PALETTE: Record<string, string> = {
  USD: '#10b981', ARS: '#3b82f6', EUR: '#8b5cf6', MXN: '#f59e0b', CLP: '#ef4444', BRL: '#06b6d4', COP: '#ec4899', PEN: '#64748b', UYU: '#0891b2', BOB: '#ea580c',
};
const PLAN_PALETTE: Record<string, string> = {
  Total: '#3b82f6', 'Básico': '#10b981', Free: '#94a3b8', Otros: '#8b5cf6', 'Partido único': '#94a3b8',
};
const MARKET_LABEL: Record<string, string> = {
  Argentina: '🇦🇷 Argentina', Brazil: '🇧🇷 Brasil', Bolivia: '🇧🇴 Bolivia', Chile: '🇨🇱 Chile', Ecuador: '🇪🇨 Ecuador',
  Peru: '🇵🇪 Perú', Uruguay: '🇺🇾 Uruguay', Paraguay: '🇵🇾 Paraguay', Venezuela: '🇻🇪 Venezuela', Colombia: '🇨🇴 Colombia',
  Mexico: '🇲🇽 México', 'United States of America': '🇺🇸 Estados Unidos', Spain: '🇪🇸 España',
};
const MONTH_FULL_ES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const SEASON_MONTH_ORDER = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

type SeasonMetric =
  | 'tx_mensual' | 'tx_anual' | 'tx_nuevas' | 'tx_reactivadas' | 'tx_recurrentes'
  | 'activos' | 'bajas' | 'ingresos_netos_usd' | 'ingresos_netos_local';
const SEASON_METRICS: { key: SeasonMetric; label: string; title: string }[] = [
  { key: 'tx_mensual', label: 'Transacciones mensuales', title: 'TRANSACCIONES MENSUALES' },
  { key: 'tx_anual', label: 'Transacciones anuales', title: 'TRANSACCIONES ANUALES' },
  { key: 'tx_nuevas', label: 'Transacciones nuevas (altas)', title: 'TRANSACCIONES NUEVAS (ALTAS)' },
  { key: 'tx_reactivadas', label: 'Transacciones reactivadas', title: 'TRANSACCIONES REACTIVADAS' },
  { key: 'tx_recurrentes', label: 'Transacciones recurrentes', title: 'TRANSACCIONES RECURRENTES' },
  { key: 'activos', label: 'Suscriptores activos (fin de mes)', title: 'SUSCRIPTORES ACTIVOS (FIN DE MES)' },
  { key: 'bajas', label: 'Bajas', title: 'BAJAS' },
  { key: 'ingresos_netos_usd', label: 'Ingresos netos (USD)', title: 'INGRESOS NETOS (USD)' },
  { key: 'ingresos_netos_local', label: 'Ingresos netos (moneda local)', title: 'INGRESOS NETOS (MONEDA LOCAL)' },
];

const sumBy = <T,>(rows: T[], f: (r: T) => number): number => rows.reduce((a, r) => a + f(r), 0);

export function FinancieroView() {
  const url = `/api/financiero/economia?${useFilterQS()}`;
  const { data, error, isLoading } = useSWR<EconomiaDTO>(url, fetcher);
  const countries = useFilters((s) => s.countries);
  const [lcPlatform, setLcPlatform] = useState<'all' | 'MercadoPago' | 'Stripe'>('all');
  const [seasonMetric, setSeasonMetric] = useState<SeasonMetric>('tx_mensual');
  const [cat, setCat] = useState({ market: 'ALL', season: 'ALL', plan: 'ALL', currency: 'ALL', price: 'ALL' });

  /** Todo lo mensual, indexado por 'YYYY-MM': la lista de meses del rango y
   *  los mapas que cada gráfico y cada tabla leen. */
  const m = useMemo(() => {
    const empty = {
      list: [] as string[],
      buckets: new Map<string, MonthlyLifecyclePoint>(),
      active: new Map<string, ActiveByMonthPoint>(),
      netUsd: new Map<string, number>(),
      grossUsd: new Map<string, number>(),
      feesUsdByGw: new Map<string, Map<string, number>>(),
      netLocal: new Map<string, Map<string, number>>(),
      grossLocal: new Map<string, Map<string, number>>(),
      netLocalPlatforms: new Map<string, Set<string>>(),
    };
    if (!data) return empty;
    const lc = data.lifecycle;
    const g = data.gateway;
    for (const r of lc.monthly) empty.buckets.set(ym(r.month), r);
    for (const r of lc.activeByMonth) empty.active.set(ym(r.month), r);
    for (const r of g.netUsdByMonth) {
      const k = ym(r.month);
      if (r.netUsd !== null) empty.netUsd.set(k, (empty.netUsd.get(k) ?? 0) + r.netUsd);
      if (r.grossUsd !== null) empty.grossUsd.set(k, (empty.grossUsd.get(k) ?? 0) + r.grossUsd);
      if (r.feesUsd !== null) {
        const byGw = empty.feesUsdByGw.get(k) ?? new Map<string, number>();
        byGw.set(r.platformName, (byGw.get(r.platformName) ?? 0) + r.feesUsd);
        empty.feesUsdByGw.set(k, byGw);
      }
    }
    for (const r of g.netByMonth) {
      const k = ym(r.month);
      const nl = empty.netLocal.get(r.settlementCurrency) ?? new Map<string, number>();
      nl.set(k, (nl.get(k) ?? 0) + r.net);
      empty.netLocal.set(r.settlementCurrency, nl);
      const gl = empty.grossLocal.get(r.settlementCurrency) ?? new Map<string, number>();
      gl.set(k, (gl.get(k) ?? 0) + r.grossSettlement);
      empty.grossLocal.set(r.settlementCurrency, gl);
      const ps = empty.netLocalPlatforms.get(r.settlementCurrency) ?? new Set<string>();
      ps.add(r.platformName);
      empty.netLocalPlatforms.set(r.settlementCurrency, ps);
    }
    empty.list = Array.from(new Set([...empty.buckets.keys(), ...empty.active.keys(), ...empty.netUsd.keys()])).sort();
    return empty;
  }, [data]);

  /** Temporadas deportivas del rango, agregadas como el prototipo. */
  const seasons = useMemo(() => {
    const agg = new Map<number, { months: string[]; tx: number; bajas: number; netUsd: number; activePeak: number; activePeakMonth: string | null }>();
    for (const month of m.list) {
      const s = monthToSeason(month);
      const a = agg.get(s) ?? { months: [], tx: 0, bajas: 0, netUsd: 0, activePeak: 0, activePeakMonth: null };
      a.months.push(month);
      const b = m.buckets.get(month);
      if (b) {
        a.tx += b.newSubscribers + b.recurring + b.reactivated + b.oneOff;
        a.bajas += b.churned;
      }
      a.netUsd += m.netUsd.get(month) ?? 0;
      const act = m.active.get(month)?.total ?? 0;
      if (act > a.activePeak) { a.activePeak = act; a.activePeakMonth = month; }
      agg.set(s, a);
    }
    const lastTxMonth = m.list.length ? m.list[m.list.length - 1] : null;
    return Array.from(agg.entries())
      .sort(([x], [y]) => x - y)
      .map(([s, a]) => {
        const fr = seasonFullRange(s);
        const isPartial = a.months.length < 12;
        const inProgress = lastTxMonth !== null && lastTxMonth < fr.last;
        const label = inProgress ? `${seasonLabel(s)} ⏳` : isPartial ? `${seasonLabel(s)} *` : seasonLabel(s);
        const notes: string[] = [];
        if (isPartial) notes.push(`${a.months.length}/12 meses en rango`);
        if (a.activePeakMonth) notes.push(`pico de activos: ${a.activePeakMonth}`);
        return { start: s, label, footer: notes.join(' · '), ...a };
      });
  }, [m]);

  /** La tabla mes × temporada para la métrica elegida. */
  const seasonTable = useMemo(() => {
    const byMonth = new Map<string, number>();
    let localCurrency = '';
    if (seasonMetric === 'activos') {
      for (const [k, v] of m.active) byMonth.set(k, v.total);
    } else if (seasonMetric === 'ingresos_netos_usd') {
      for (const [k, v] of m.netUsd) byMonth.set(k, v);
    } else if (seasonMetric === 'ingresos_netos_local') {
      // La moneda dominante del rango, como el prototipo: la de mayor neto.
      let best = -1;
      for (const [ccy, months] of m.netLocal) {
        const tot = Array.from(months.values()).reduce((a, b) => a + b, 0);
        if (tot > best) { best = tot; localCurrency = ccy; }
      }
      for (const [k, v] of m.netLocal.get(localCurrency) ?? []) byMonth.set(k, v);
    } else {
      const pick: Record<Exclude<SeasonMetric, 'activos' | 'ingresos_netos_usd' | 'ingresos_netos_local'>, (b: MonthlyLifecyclePoint) => number> = {
        tx_mensual: (b) => b.mensual,
        tx_anual: (b) => b.anual,
        tx_nuevas: (b) => b.newSubscribers,
        tx_reactivadas: (b) => b.reactivated,
        tx_recurrentes: (b) => b.recurring,
        bajas: (b) => b.churned,
      };
      for (const [k, b] of m.buckets) byMonth.set(k, pick[seasonMetric](b));
    }
    const months = Array.from(byMonth.keys()).sort();
    if (months.length === 0) return null;
    const firstM = months[0];
    const lastM = months[months.length - 1];
    const seasonKeys: number[] = [];
    for (let s = monthToSeason(firstM); s <= monthToSeason(lastM); s += 1) seasonKeys.push(s);
    const values = new Map<number, Map<number, number | null>>();
    const totals = new Map<number, number>();
    const counts = new Map<number, number>();
    for (const s of seasonKeys) {
      const row = new Map<number, number | null>();
      let tot = 0;
      let n = 0;
      for (const mo of SEASON_MONTH_ORDER) {
        const yr = mo >= 9 ? s : s + 1;
        const key = `${yr}-${String(mo).padStart(2, '0')}`;
        if (key < firstM || key > lastM) { row.set(mo, null); continue; }
        const v = byMonth.get(key) ?? 0;
        row.set(mo, v);
        tot += v;
        n += 1;
      }
      values.set(s, row);
      totals.set(s, tot);
      counts.set(s, n);
    }
    const isMoneyUsd = seasonMetric === 'ingresos_netos_usd';
    const isMoneyLocal = seasonMetric === 'ingresos_netos_local';
    const fmtVal = (v: number): string =>
      isMoneyUsd
        ? fmtUsd(v)
        : isMoneyLocal
          ? `${v < 0 ? '-' : ''}${Math.abs(v).toLocaleString('es-AR', { maximumFractionDigits: 2 })}${localCurrency ? ` ${localCurrency}` : ''}`
          : fmt(v);
    const title = isMoneyLocal && localCurrency ? `INGRESOS NETOS (${localCurrency})` : SEASON_METRICS.find((x) => x.key === seasonMetric)!.title;
    return { seasonKeys, values, totals, counts, fmtVal, title, invert: seasonMetric === 'bajas' };
  }, [m, seasonMetric]);

  /** El catálogo con los cinco selectores del prototipo, precio incluido. */
  const catalog = useMemo(() => {
    if (!data) return null;
    const all = data.catalog;
    const planKey = (r: EconomiaDTO['catalog'][number]) => `${r.planFamily}|${r.planFrequency}`;
    let base = all;
    if (cat.market !== 'ALL') base = base.filter((r) => r.market === cat.market);
    if (cat.season !== 'ALL') base = base.filter((r) => r.season === cat.season);
    if (cat.plan !== 'ALL') base = base.filter((r) => planKey(r) === cat.plan);
    if (cat.currency !== 'ALL') base = base.filter((r) => r.currency === cat.currency);
    // Los precios que quedan tras los otros cuatro filtros, agrupados por moneda
    // y precio redondeado, con su cantidad de Pagos para poder ordenar.
    const priceBucket = new Map<string, { currency: string; price: number; count: number }>();
    for (const r of base) {
      const pR = Math.round(r.price);
      const k = `${r.currency}|${pR}`;
      const prev = priceBucket.get(k) ?? { currency: r.currency, price: pR, count: 0 };
      prev.count += r.txCount;
      priceBucket.set(k, prev);
    }
    const prices = Array.from(priceBucket.values()).sort((a, b) =>
      a.currency !== b.currency ? a.currency.localeCompare(b.currency) : a.price - b.price,
    );
    const priceStillThere = cat.price === 'ALL' || prices.some((p) => `${p.currency}|${p.price}` === cat.price);
    let rows = base;
    if (cat.price !== 'ALL' && priceStillThere) {
      const [c, p] = cat.price.split('|');
      rows = rows.filter((r) => r.currency === c && Math.round(r.price) === Number(p));
    }
    rows = [...rows].sort((a, b) =>
      a.market !== b.market ? a.market.localeCompare(b.market)
        : a.planFamily !== b.planFamily ? a.planFamily.localeCompare(b.planFamily)
          : a.planFrequency !== b.planFrequency ? a.planFrequency.localeCompare(b.planFrequency)
            : a.season !== b.season ? a.season.localeCompare(b.season)
              : b.txCount - a.txCount,
    );
    let lastKey = '';
    let rank = 0;
    const ranked = rows.map((r) => {
      const k = `${r.market}|${r.planFamily}|${r.planFrequency}|${r.season}`;
      rank = k === lastKey ? rank + 1 : 1;
      lastKey = k;
      return { ...r, rank };
    });
    return {
      rows: ranked,
      markets: Array.from(new Set(all.map((r) => r.market))).sort(),
      seasons: Array.from(new Set(all.map((r) => r.season))).sort(),
      plans: Array.from(new Map(all.map((r) => [planKey(r), `${r.planFamily} · ${r.planFrequency}`])).entries()).sort((a, b) => a[1].localeCompare(b[1])),
      currencies: Array.from(new Set(all.map((r) => r.currency))).sort(),
      prices,
    };
  }, [data, cat]);

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

  const lc = data.lifecycle;
  const g = data.gateway;
  const pc = lc.periodComparison;
  const A = pc.current;
  const B = pc.previous;
  const asOfShort = `${lc.asOf.slice(8, 10)}/${lc.asOf.slice(5, 7)}`;
  const countryLabel = countries.length === 0 ? 'Todos los países' : countries.join(', ');
  const countryNote = countries.length === 0 ? '· todos los países' : `· ${countries.join(', ')}`;

  // ── Totales del rango, sobre los meses que toca ──
  const bucketsInRange = Array.from(m.buckets.values());
  const totals = {
    nuevos: sumBy(bucketsInRange, (b) => b.newSubscribers),
    recurrentes: sumBy(bucketsInRange, (b) => b.recurring),
    reactivados: sumBy(bucketsInRange, (b) => b.reactivated),
    oneOff: sumBy(bucketsInRange, (b) => b.oneOff),
    bajas: sumBy(bucketsInRange, (b) => b.churned),
    mensual: sumBy(bucketsInRange, (b) => b.mensual),
    anual: sumBy(bucketsInRange, (b) => b.anual),
  };
  const txTotal = totals.nuevos + totals.recurrentes + totals.reactivados + totals.oneOff;
  const monthsWithTx = bucketsInRange.filter((b) => b.newSubscribers + b.recurring + b.reactivated + b.oneOff > 0).length;
  const freqTot = totals.mensual + totals.anual;
  const freqOtro = Math.max(0, totals.nuevos + totals.recurrentes + totals.reactivados - freqTot);
  const freqLead = freqTot > 0 ? (totals.mensual >= totals.anual ? 'Mensual' : 'Anual') : '—';
  const freqLeadPct = freqTot > 0 ? pctOf(freqLead === 'Mensual' ? totals.mensual : totals.anual, freqTot) : '—';

  const planFam = new Map<string, number>();
  for (const r of data.catalog) planFam.set(r.planFamily || 'Sin clasificar', (planFam.get(r.planFamily || 'Sin clasificar') ?? 0) + r.txCount);
  const planSorted = Array.from(planFam.entries()).sort((a, b) => b[1] - a[1]);
  const planTot = sumBy(planSorted, ([, v]) => v);

  // ── Económicos, en USD y por Proveedor ──
  const usd = g.usdTotals;
  const sumUsd = (f: (t: (typeof usd)[number]) => number | null): number => sumBy(usd, (t) => f(t) ?? 0);
  const totalUsdNet = sumUsd((t) => t.netUsd);
  const totalUsdGross = sumUsd((t) => t.grossUsd);
  const totalFeeUsd = sumUsd((t) => t.feesUsd);
  const byGw = (f: (t: (typeof usd)[number]) => number | null): { name: string; v: number }[] => {
    const idx = new Map<string, number>();
    for (const t of usd) idx.set(t.platformName, (idx.get(t.platformName) ?? 0) + (f(t) ?? 0));
    return Array.from(idx.entries()).map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
  };
  const netByGw = byGw((t) => t.netUsd);
  const grossByGw = byGw((t) => t.grossUsd);
  const feeByGw = byGw((t) => t.feesUsd);
  const netByCur = g.settlementTotals
    .reduce((idx, t) => idx.set(t.settlementCurrency, (idx.get(t.settlementCurrency) ?? 0) + t.net), new Map<string, number>());
  const netByCurSorted = Array.from(netByCur.entries()).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const feePct = totalUsdGross > 0 ? `${((totalFeeUsd / totalUsdGross) * 100).toFixed(1)}%` : '—';
  const usdMissing = usd.filter((t) => t.netUsd === null);

  // ── Snapshot: rolling 30 días ──
  const gwWindow = (side: typeof A, name: string): number =>
    Math.round(side.netUsdByPlatform.find((p) => p.platformName === name)?.netUsd ?? 0);
  const netA = sumBy(A.netUsdByPlatform, (p) => p.netUsd ?? 0);
  const netB = sumBy(B.netUsdByPlatform, (p) => p.netUsd ?? 0);
  const gwNames = Array.from(new Set([...A.netUsdByPlatform, ...B.netUsdByPlatform].map((p) => p.platformName))).sort();

  // ── Series mensuales ──
  const mList = m.list;
  const bk = (month: string) => m.buckets.get(month);
  const combTx = mList.map((x) => { const b = bk(x); return b ? b.newSubscribers + b.recurring + b.reactivated + b.oneOff : 0; });

  // ── Últimos 15 días ──
  const dLabels = lc.daily.map((r) => r.day.slice(5).replace('-', '/'));
  const dTitles = lc.daily.map((r) => r.day);

  // ── Antigüedad del último cargo ──
  const lcRows = lc.lastCharge.filter((r) => lcPlatform === 'all' || r.platformName === lcPlatform);
  const lcVals = LC_BUCKETS.map((b) => sumBy(lcRows.filter((r) => r.bucket === b), (r) => r.count));
  const lcUnknown = sumBy(lcRows.filter((r) => r.bucket === 'unknown'), (r) => r.count);

  // ── Ingresos netos por mes, una línea por moneda de liquidación ──
  const revCurrencies = Array.from(m.netLocal.keys()).sort();

  // ── Cancelaciones oficiales ──
  const cancelPlatforms = Array.from(new Set(g.subscriptionsByMonth.map((r) => r.platformName))).sort();
  const cancelByGw = cancelPlatforms.map((p) => ({
    platformName: p,
    data: mList.map((x) => sumBy(g.subscriptionsByMonth.filter((r) => r.platformName === p && ym(r.month) === x), (r) => r.canceled)),
  }));
  const churned = g.subscriptionsByStatus.filter((r) => r.lifecycle === 'churned');
  const canceledTotal = sumBy(churned, (r) => r.count);
  const undated = canceledTotal - sumBy(churned, (r) => r.withCanceledAt);

  // ── Comisiones por Proveedor en USD ──
  const feePlatforms = Array.from(new Set(g.netUsdByMonth.map((r) => r.platformName))).sort();
  const feesByGw = feePlatforms.map((p) => ({ platformName: p, data: mList.map((x) => m.feesUsdByGw.get(x)?.get(p) ?? 0) }));

  // ── Tabla ingresos mes a mes: las dos monedas grandes con columna propia ──
  const mainCcys = ['ARS', 'USD'].filter((c) => m.netLocal.has(c));
  const otherCcys = revCurrencies.filter((c) => !mainCcys.includes(c));
  const ccyPlatforms = (c: string) => Array.from(m.netLocalPlatforms.get(c) ?? []).map((p) => (p === 'MercadoPago' ? 'MP' : p)).join('+');

  const lifetime = lc.lifetime;
  const fmtMonths = (v: number | null): string => (v === null ? '—' : `${v.toLocaleString('es-AR', { maximumFractionDigits: 1 })} meses`);

  return (
    <div>
      {/* ── Snapshot rolling ── */}
      <SectionLabel first>
        📅 Últimos {pc.windowDays} días ({fmtDayShort(A.start)} → {fmtDayShort(A.end)}) vs {pc.windowDays} días anteriores ({fmtDayShort(B.start)} → {fmtDayShort(B.end)})
      </SectionLabel>
      <div className="proto-ms-grid">
        <MsCol
          tone="tx"
          title="Transacciones"
          hint="Pagos exitosos de los últimos 30 días hasta el último día con Pagos, contra los 30 anteriores. Cada Pago se clasifica por lo que significó para su Subscriber: alta si es el primero de su vida, recurrente si llega antes de 37 días tras el vencimiento anterior, reactivado si llega después. Bajas: Subscribers que salieron del pool en la ventana. Responde a los filtros."
          big={fmt(A.tx.total)}
          bigDelta={{ d: delta(A.tx.total, B.tx.total), prev: fmt(B.tx.total) }}
          rows={[
            { swatch: '#10b981', label: 'Altas', value: fmt(A.tx.newSubscribers), d: delta(A.tx.newSubscribers, B.tx.newSubscribers) },
            { swatch: '#3b82f6', label: 'Recurrentes', value: fmt(A.tx.recurring), d: delta(A.tx.recurring, B.tx.recurring) },
            { swatch: '#f59e0b', label: 'Reactivados', value: fmt(A.tx.reactivated), d: delta(A.tx.reactivated, B.tx.reactivated) },
            { swatch: '#ef4444', label: 'Bajas', value: fmt(A.tx.churned), d: delta(A.tx.churned, B.tx.churned, true) },
            { swatch: '#94a3b8', label: 'Partido único', value: fmt(A.tx.oneOff), d: delta(A.tx.oneOff, B.tx.oneOff) },
            { swatch: '#1d4ed8', label: 'Mensuales', value: fmt(A.tx.mensual), d: delta(A.tx.mensual, B.tx.mensual) },
            { swatch: '#d97706', label: 'Anuales', value: fmt(A.tx.anual), d: delta(A.tx.anual, B.tx.anual) },
          ]}
        />
        <MsCol
          tone="active"
          title="Suscriptores activos"
          hint="Subscribers con un Pago exitoso que cubre el último día de cada ventana (vencimiento más 7 días de gracia). Mensuales y Anuales cuentan por Período del Pago; Total y Básico por familia del plan. Una persona con dos derechos cuenta en dos filas y una vez en el total."
          big={fmt(A.active.total)}
          bigDelta={{ d: delta(A.active.total, B.active.total), prev: fmt(B.active.total) }}
          rows={[
            { swatch: '#3b82f6', label: 'Mensuales', value: fmt(A.active.mensual), d: delta(A.active.mensual, B.active.mensual) },
            { swatch: '#f59e0b', label: 'Anuales', value: fmt(A.active.anual), d: delta(A.active.anual, B.active.anual) },
            { head: 'Por familia' },
            { swatch: '#8b5cf6', label: 'Total', value: fmt(A.active.famTotal), d: delta(A.active.famTotal, B.active.famTotal) },
            { swatch: '#10b981', label: 'Básico', value: fmt(A.active.famBasico), d: delta(A.active.famBasico, B.active.famBasico) },
          ]}
        />
        <MsCol
          tone="revenue"
          title="Ingresos netos USD"
          hint="Neto de liquidación de cada Proveedor en la ventana — bruto liquidado menos comisión y retención, por fecha de captura — convertido a USD con la cotización de cada día (ARS al blue venta). PayPal no tiene feed de comisiones y no aparece."
          big={fmtUsd(Math.round(netA))}
          bigDelta={{ d: delta(netA, netB), prev: fmtUsd(Math.round(netB)) }}
          rows={gwNames.map((name) => ({
            swatch: GW_COLOR[name] ?? '#64748b',
            label: name,
            value: fmtUsdRound(gwWindow(A, name)),
            d: delta(gwWindow(A, name), gwWindow(B, name)),
          }))}
        />
      </div>

      {/* ── KPIs · Suscriptores y transacciones ── */}
      <SectionLabel>👥 Suscriptores y transacciones</SectionLabel>
      <div className="proto-kpis">
        <Kpi
          tone="purple"
          icon="👥"
          title="Suscriptores activos"
          value={fmt(A.active.total)}
          hint="Foto al último día con Pagos: Subscribers únicos con un Pago exitoso que cubre ese día (vencimiento más 7 días de gracia). Es la misma regla de «activo» de todo el dashboard. Responde a los filtros."
        >
          snapshot al {fmtDayShort(lc.asOf)} · total actualmente activos en la plataforma
          <Breakdown
            rows={[
              { swatch: '#3b82f6', label: 'Mensuales', value: fmt(A.active.mensual), pct: pctOf(A.active.mensual, A.active.mensual + A.active.anual), color: '#1d4ed8' },
              { swatch: '#f59e0b', label: 'Anuales', value: fmt(A.active.anual), pct: pctOf(A.active.anual, A.active.mensual + A.active.anual), color: '#d97706' },
              { head: 'Por familia' },
              { swatch: '#8b5cf6', label: 'Total', value: fmt(A.active.famTotal), pct: pctOf(A.active.famTotal, A.active.famTotal + A.active.famBasico), color: '#7c3aed' },
              { swatch: '#10b981', label: 'Básico', value: fmt(A.active.famBasico), pct: pctOf(A.active.famBasico, A.active.famTotal + A.active.famBasico), color: '#059669' },
            ]}
          />
        </Kpi>
        <Kpi
          tone="blue"
          icon="📊"
          title="Transacciones"
          value={fmt(txTotal)}
          hint="Pagos exitosos de los meses que toca el rango, clasificados: alta (primer Pago de la vida del Subscriber), recurrente (antes de 37 días tras el vencimiento anterior), reactivado (después), partido único (sin derecho recurrente). Bajas: Subscribers cuya cobertura venció ese mes sin renovación; van aparte porque son otro flujo."
        >
          eventos de pago · {monthsWithTx} {monthsWithTx === 1 ? 'mes' : 'meses'} en rango
          <Breakdown
            rows={[
              { swatch: '#10b981', label: 'Altas (nuevos)', value: fmt(totals.nuevos), pct: pctOf(totals.nuevos, txTotal), color: '#059669' },
              { swatch: '#f59e0b', label: 'Reactivados', value: fmt(totals.reactivados), pct: pctOf(totals.reactivados, txTotal), color: '#d97706' },
              { swatch: '#3b82f6', label: 'Recurrentes', value: fmt(totals.recurrentes), pct: pctOf(totals.recurrentes, txTotal), color: '#1d4ed8' },
              { swatch: '#94a3b8', label: 'Partido único', value: fmt(totals.oneOff), pct: pctOf(totals.oneOff, txTotal), color: '#475569' },
              { swatch: '#ef4444', label: 'Bajas', value: `−${fmt(totals.bajas)}`, pct: 'flujo', color: '#dc2626', sep: true },
            ]}
          />
        </Kpi>
        <Kpi
          tone="amber"
          icon="📅"
          title="Mensual vs Anual"
          value={fmt(freqTot)}
          hint="Pagos de suscripción (sin partido único) por Período del Pago: mensual o anual. «Otro» son los Pagos de suscripción bajo un Tier Free u Otros, que no tienen Período."
        >
          transacciones de suscripción · {freqLead !== '—' ? `${freqLead} domina con ${freqLeadPct}` : 'sin datos'}
          <Breakdown
            rows={[
              { swatch: '#3b82f6', label: 'Mensual', value: fmt(totals.mensual), pct: pctOf(totals.mensual, freqTot), color: '#1d4ed8' },
              { swatch: '#f59e0b', label: 'Anual', value: fmt(totals.anual), pct: pctOf(totals.anual, freqTot), color: '#d97706' },
              ...(freqOtro > 0 ? [{ swatch: '#94a3b8', label: 'Otro / Único', value: fmt(freqOtro), pct: pctOf(freqOtro, freqTot), color: '#475569' }] : []),
            ]}
          />
        </Kpi>
        <Kpi
          tone="green"
          icon="🎟"
          title="Por plan"
          value={fmt(planTot)}
          hint="Pagos exitosos del rango por familia de plan (Total, Básico, Free…), inferida del Tier de cada Pago. Cuenta Pagos, no importes ni personas; el top 5."
        >
          transacciones · top: {planSorted[0]?.[0] ?? '—'}{planSorted[0] && planTot > 0 ? ` (${pctOf(planSorted[0][1], planTot)})` : ''}
          <Breakdown
            rows={planSorted.slice(0, 5).map(([name, v]) => ({
              swatch: PLAN_PALETTE[name] ?? '#64748b',
              label: name,
              value: fmt(v),
              pct: pctOf(v, planTot),
            }))}
          />
        </Kpi>
      </div>

      {/* ── KPIs · Ingresos y costes ── */}
      <SectionLabel>💰 Ingresos y costes</SectionLabel>
      <div className="proto-kpis">
        <Kpi
          tone="green"
          icon="💵"
          title="Ingresos netos (USD)"
          value={fmtUsd(totalUsdNet)}
          hint="Neto de liquidación del rango — bruto liquidado menos comisión y retención según el feed de comisiones de cada Proveedor — convertido a USD día por día (ARS al blue venta; lo liquidado en USD sin convertir). El desglose es el neto en cada moneda de liquidación, sin convertir. PayPal no tiene feed y queda afuera."
        >
          por moneda de liquidación
          <Breakdown
            rows={
              netByCurSorted.length
                ? netByCurSorted.map(([cu, v]) => ({ swatch: CUR_PALETTE[cu] ?? '#94a3b8', label: cu, value: fmt(Math.round(v)) }))
                : [{ swatch: '#94a3b8', label: 'sin ingresos', value: '' }]
            }
          />
        </Kpi>
        <Kpi
          tone="blue"
          icon="🏦"
          title="Ingresos por pasarela (netos)"
          value={fmtUsd(sumBy(netByGw, (x) => x.v))}
          hint="El mismo neto en USD, repartido por Proveedor. Dos cifras en USD sí se suman; una moneda sin cotización (hoy EUR) queda ausente y no resta."
        >
          neto combinado en USD
          <Breakdown rows={netByGw.map((x) => ({ swatch: GW_COLOR[x.name] ?? '#64748b', label: x.name, value: fmtUsdRound(x.v), pct: pctOf(x.v, sumBy(netByGw, (y) => y.v)) }))} />
        </Kpi>
        <Kpi
          tone="slate"
          icon="💰"
          title="Ingresos brutos (USD)"
          value={fmtUsd(totalUsdGross)}
          hint="Bruto liquidado por cada Proveedor en el rango, convertido a USD día por día, antes de comisión y retención. Es el bruto del plano de liquidación, no lo facturado al suscriptor en su moneda."
        >
          antes de fees · por pasarela
          <Breakdown rows={grossByGw.map((x) => ({ swatch: GW_COLOR[x.name] ?? '#64748b', label: x.name, value: fmtUsdRound(x.v), pct: pctOf(x.v, totalUsdGross) }))} />
        </Kpi>
        <Kpi
          tone="red"
          icon="💳"
          title="Fees pagados (USD)"
          value={fmtUsd(totalFeeUsd)}
          hint="La comisión de cada Proveedor en el rango, en USD día por día. Sólo comisión: la retención impositiva de MercadoPago no es un fee, vuelve como crédito fiscal y no está acá. El % es comisión ÷ bruto liquidado."
        >
          {feePct} del bruto · por pasarela
          <Breakdown rows={feeByGw.map((x) => ({ swatch: GW_COLOR[x.name] ?? '#64748b', label: x.name, value: fmtUsdRound(x.v), pct: pctOf(x.v, totalFeeUsd) }))} />
        </Kpi>
      </div>
      {usdMissing.length > 0 && (
        <div className="proto-foot" style={{ margin: '6px 2px 0' }}>
          Sin cotización, y por eso ausentes de toda cifra en USD: {usdMissing.map((t) => `${t.platformName} ${t.settlementCurrency}`).join(', ')}.
        </div>
      )}

      {/* ── Vista consolidada ── */}
      <div style={{ marginTop: 20 }} />
      <Card
        title="📈 Vista consolidada: ingresos, activos y transacciones"
        hint="Neto de liquidación por mes convertido a USD día por día, contra la cantidad de Pagos exitosos de ese mes y los Subscribers con acceso vigente al cierre del mes. Las series usan relojes distintos: fecha de captura, fecha del Pago y último día del mes."
        desc="Barras: ingresos netos en USD por mes (eje izquierdo). Líneas: suscriptores activos reales y número de transacciones (eje derecho). Permite ver de un vistazo si los ingresos crecen en línea con la base de suscriptores activa y el volumen transaccional."
      >
        {mList.length === 0 ? (
          <div className="no-data">Sin datos en rango</div>
        ) : (
          <CombinedChart
            labels={mList}
            usd={mList.map((x) => m.netUsd.get(x) ?? 0)}
            active={mList.map((x) => m.active.get(x)?.total ?? 0)}
            tx={combTx}
          />
        )}
      </Card>

      {/* ── Últimos 15 días ── */}
      <Card
        title="📅 Últimos 15 días — altas, reactivados, bajas y suscripciones netas (por día)"
        note={`${countryNote} · hasta el ${asOfShort}`}
        hint="Un Subscriber está activo un día si algún Pago exitoso lo cubre (desde su fecha hasta su vencimiento más 7 días de gracia). Alta nueva: entra al pool con su primer Pago de la vida. Reactivado: vuelve al pool tras haber salido. Baja: estaba ayer y hoy no. Las netas coinciden exactamente con la variación diaria de activos. La serie termina en el último día con Pagos, no en hoy."
        desc={
          <>
            Barras verdes (<b>altas nuevas</b>): suscriptores que pagan por primera vez en su vida. Barras naranjas (<b>reactivados</b>): ya pagaron antes, salieron del pool y vuelven hoy. Barras rojas (<b>bajas</b>): estaban activos ayer y hoy ya no. Línea azul (<b>netas</b>) = altas + reactivados − bajas, que coincide con el delta diario de la curva de activos. Responde a los filtros de arriba.
          </>
        }
      >
        {lc.daily.length === 0 ? (
          <div className="no-data">Sin Pagos</div>
        ) : (
          <Daily15Chart
            labels={dLabels}
            titles={dTitles}
            nuevas={lc.daily.map((r) => r.newSubscribers)}
            reactivados={lc.daily.map((r) => r.reactivated)}
            bajas={lc.daily.map((r) => r.churned)}
            netas={lc.daily.map((r) => r.net)}
          />
        )}
      </Card>

      <Card
        title="👥 Últimos 15 días — suscriptores activos vigentes"
        note={`${countryNote} · hasta el ${asOfShort}`}
        hint="Subscribers únicos con un Pago exitoso que cubre ese día, vencimiento más 7 días de gracia incluidos. Cada persona cuenta una vez por día aunque tenga varios Pagos. El eje no arranca en cero para que se vea el movimiento diario."
        desc="Snapshot diario de suscriptores activos (personas únicas con suscripción vigente al cierre del día): mensuales y anuales dentro de su cobertura pagada más 7 días de gracia. Responde a los filtros de arriba."
      >
        {lc.daily.length === 0 ? (
          <div className="no-data">Sin Pagos</div>
        ) : (
          <DailyActive15Chart labels={dLabels} titles={dTitles} active={lc.daily.map((r) => r.active)} />
        )}
      </Card>

      {/* ── Real vs Plan ── */}
      <Card
        title="📊 Mes en curso — Real vs Plan vs Mes Anterior"
        hint="Compara, día por día del mes en curso y por Proveedor, lo cobrado neto contra el objetivo del plan y contra el mismo día del mes anterior. El objetivo llega de una planilla que todavía no está conectada."
        desc={
          <>
            Día por día del mes en curso, por pasarela y en moneda nativa: <b>Real</b> = ingresos netos cobrados; <b>Plan</b> = lo que se preveía facturar; <b>Real Mes Anterior</b> = lo facturado el mismo día del mes pasado. Diferencias absolutas en moneda nativa; porcentajes relativos. Verde = mejor que la referencia, rojo = peor.
          </>
        }
      >
        <div className="proto-controls">
          <label>
            Pasarela
            <select disabled defaultValue="mercadopago">
              <option value="mercadopago">Mercado Pago (ARS)</option>
              <option value="stripe">Stripe (USD)</option>
            </select>
          </label>
          <label>
            Mes a mostrar
            <select disabled defaultValue="">
              <option value="">{lc.asOf.slice(0, 7)}</option>
            </select>
          </label>
        </div>
        <div className="proto-table-scroll" style={{ marginBottom: 14 }}>
          <table className="tbl-mt">
            <thead>
              <tr>
                <th>Fecha</th>
                <th className="right">Real</th>
                <th className="right">Plan</th>
                <th className="right">Dif vs Plan</th>
                <th className="right">Var Real vs Plan</th>
                <th className="right">Real Mes Ant.</th>
                <th className="right">Dif vs Mes Ant.</th>
                <th className="right">Var Real vs Mes Ant.</th>
              </tr>
            </thead>
          </table>
        </div>
        <Pending kind="plan" />
      </Card>

      {/* ── Transacciones mensuales · Mix de planes ── */}
      <div className="proto-grid2">
        <Card
          title="Transacciones mensuales"
          hint="Cada Pago exitoso del mes, clasificado: nuevo si es el primero del Subscriber, recurrente si llega antes de 37 días tras el vencimiento del anterior, reactivación si llega después, partido único si es un Pago sin derecho recurrente. Las bajas, hacia abajo, son los Subscribers cuya cobertura venció ese mes sin ningún Pago posterior que la solape. Todo sale de los Pagos, así que MercadoPago y Stripe cuentan igual."
          desc={
            <>
              Altas, recurrentes, reactivaciones y bajas mes a mes. Las <b>bajas</b> salen de los Pagos (cobertura vencida sin renovación), con fecha real; las cancelaciones que declara cada Proveedor están en la tarjeta de abajo.
            </>
          }
        >
          {mList.length === 0 ? (
            <div className="no-data">Sin Pagos en rango</div>
          ) : (
            <FlowChart
              labels={mList}
              recurring={mList.map((x) => bk(x)?.recurring ?? 0)}
              nuevos={mList.map((x) => bk(x)?.newSubscribers ?? 0)}
              reactivados={mList.map((x) => bk(x)?.reactivated ?? 0)}
              oneOff={mList.map((x) => bk(x)?.oneOff ?? 0)}
              bajas={mList.map((x) => bk(x)?.churned ?? 0)}
            />
          )}
        </Card>
        <Card
          title="Mix de planes"
          hint="Reparto de los Pagos exitosos del rango por plan y frecuencia (Básico/Total · Mensual/Anual/Free), inferidos del Tier de cada Pago. Cuenta Pagos, no importes ni suscriptores."
          desc="Distribución de eventos por tipo de suscripción"
        >
          {data.catalog.length === 0 ? (
            <div className="no-data">Sin datos</div>
          ) : (
            (() => {
              const idx = new Map<string, number>();
              for (const r of data.catalog) {
                if (!r.planFamily || !r.planFrequency) continue;
                // «Free · Free» no dice nada dos veces: una familia igual a su
                // frecuencia se nombra una sola vez.
                const k = r.planFamily === r.planFrequency ? r.planFamily : `${r.planFamily} · ${r.planFrequency}`;
                idx.set(k, (idx.get(k) ?? 0) + r.txCount);
              }
              const entries = Array.from(idx.entries()).sort((a, b) => b[1] - a[1]);
              return <PlansDonut labels={entries.map(([k]) => k)} values={entries.map(([, v]) => v)} />;
            })()
          )}
        </Card>
      </div>

      {/* ── Cancelaciones · antigüedad del último cargo ── */}
      <div className="proto-grid2">
        <Card
          title="📉 Cancelaciones por mes (MP + Stripe oficial)"
          hint="Cancelaciones registradas por cada Proveedor, bucketeadas por su fecha de cancelación. Sólo las que traen fecha entran al gráfico; MercadoPago no registra cuándo se canceló una preaprobación, así que su serie está vacía y su churn se lee del estado de la suscripción. No afectado por los filtros: una suscripción no tiene país ni plan propios."
          desc="Cancelaciones registradas oficialmente por cada pasarela: MP cuando una suscripción pasa a status «cancelled», Stripe cuando pasa a «canceled». A diferencia del cómputo heurístico, estos son eventos auténticos con su fecha exacta."
          foot={`${fmt(undated)} de ${fmt(canceledTotal)} cancelaciones no traen fecha y no se pueden dibujar en el tiempo; el churn se lee del estado.${g.subscriptionsIgnoreFilters ? ' No afectado por los filtros.' : ''}`}
        >
          {mList.length === 0 ? (
            <div className="no-data">Sin suscripciones en rango</div>
          ) : (
            <CancelMonthlyChart labels={mList} byPlatform={cancelByGw} />
          )}
        </Card>
        <Card
          title="📅 Suscriptores activos por antigüedad del último cargo"
          note={`· al ${asOfShort}`}
          hint="Suscripciones que el Proveedor da por vivas (Stripe active/past_due/trialing, MercadoPago authorized), agrupadas por los días desde su último Pago exitoso, medidos al último día con Pagos. El Pago se une a la suscripción por el id de preaprobación en MercadoPago y por el email del cliente en Stripe. No afectado por los filtros."
          desc="Distribución de suscriptores actualmente authorized/active según cuándo fue su último cobro: ideal 0-30 días (al día). Las bandas más viejas (61+) son zombies o subs en mora — buena señal preventiva de churn próximo. Filtrable por pasarela."
          foot={lcUnknown > 0 ? `${fmt(lcUnknown)} suscripciones vivas sin Pago vinculado (cliente sin Subscriber conocido) quedan fuera de las barras.` : undefined}
        >
          <div className="proto-controls">
            <label>
              Pasarela
              <select value={lcPlatform} onChange={(e) => setLcPlatform(e.target.value as typeof lcPlatform)} style={{ minWidth: 180 }}>
                <option value="all">Todas</option>
                <option value="MercadoPago">Mercado Pago</option>
                <option value="Stripe">Stripe</option>
              </select>
            </label>
          </div>
          {lcVals.every((v) => v === 0) ? (
            <div className="no-data" style={{ height: 280 }}>Sin suscripciones vivas</div>
          ) : (
            <LastChargeChart values={lcVals} />
          )}
        </Card>
      </div>

      {/* ── Vida media ── */}
      <Card
        title="⏱️ Promedio de vida de un suscriptor"
        hint="Meses de cobertura pagada por Subscriber, sumando la duración de todos sus Pagos exitosos (un mes por Pago mensual, doce por uno anual). Sólo entran los ciclos cerrados: Subscribers sin acceso vigente al último día con Pagos. Quien se fue y volvió es un solo ciclo con sus meses sumados. Responde a los filtros."
        desc="Meses promedio que un suscriptor se mantuvo activo, sumando reactivaciones (un cliente que canceló y volvió cuenta como un solo lifetime extendido). Sólo se promedian clientes «cerrados» (sin suscripción activa hoy) para no inflar con clientes vivos cuyo ciclo aún no terminó. Responde a los filtros."
        foot="Para Argentina (mayoría MP) la mediana es la mejor métrica — distribución muy sesgada por una larga cola de clientes legacy con muchos meses de antigüedad."
      >
        <div className="proto-mini-kpis">
          <div className="proto-mini-kpi">
            <div className="lbl">Promedio</div>
            <div className="val">{fmtMonths(lifetime.meanMonths)}</div>
            <div className="sub">{countryLabel.toLowerCase() === 'todos los países' ? 'todos los países (MP+Stripe)' : countryLabel} · {fmt(lifetime.closed)} clientes cerrados</div>
          </div>
          <div className="proto-mini-kpi blue">
            <div className="lbl">Mediana</div>
            <div className="val">{fmtMonths(lifetime.medianMonths)}</div>
            <div className="sub">P25 {fmt(lifetime.p25Months ?? 0)} · P75 {fmt(lifetime.p75Months ?? 0)} · max {fmt(lifetime.maxMonths ?? 0)}</div>
          </div>
        </div>
      </Card>

      {/* ── Ingresos netos por mes · activos reales ── */}
      <div className="proto-grid2">
        <Card
          title="Ingresos netos por mes"
          hint="Neto de liquidación por mes y moneda, por fecha de captura: bruto liquidado menos comisión y retención, según el feed de comisiones de cada Proveedor. La línea punteada es la suma de todo convertido a USD con la cotización de cada día."
          desc={
            <>
              Ingresos <b>netos</b> (ya restados los fees de MP y Stripe), una línea por moneda de liquidación. La línea punteada negra es el total neto en USD. ARS se convierte al dólar blue de cada día; lo liquidado en USD no se convierte; EUR no tiene cotización y no entra al total.
            </>
          }
        >
          {mList.length === 0 ? (
            <div className="no-data">Sin datos de liquidación en rango</div>
          ) : (
            <RevenueChart
              labels={mList}
              byCurrency={revCurrencies.map((c) => ({ currency: c, data: mList.map((x) => m.netLocal.get(c)?.get(x) ?? 0) }))}
              totalUsd={mList.map((x) => m.netUsd.get(x) ?? 0)}
            />
          )}
        </Card>
        <Card
          title="Suscriptores activos reales"
          hint="Subscribers únicos con un Pago exitoso que cubre el último día del mes (vencimiento más 7 días de gracia). Barras: bajo un plan mensual y bajo uno anual; una persona con dos derechos cuenta en dos barras. Línea: personas únicas. El mes en curso se mide al último día con Pagos."
          desc={
            <>
              Personas únicas con una <b>suscripción vigente</b> al cierre de cada mes: mensuales y anuales dentro de su cobertura pagada más 7 días de gracia. A diferencia del resto del dashboard, aquí cada persona cuenta una sola vez por mes aunque tenga varias transacciones.
            </>
          }
        >
          {mList.length === 0 ? (
            <div className="no-data">Sin Pagos en rango</div>
          ) : (
            <ActiveChart
              labels={mList.map((x) => (m.active.get(x)?.partial ? `${x} ⏳` : x))}
              mensual={mList.map((x) => m.active.get(x)?.mensual ?? 0)}
              anual={mList.map((x) => m.active.get(x)?.anual ?? 0)}
              total={mList.map((x) => m.active.get(x)?.total ?? 0)}
            />
          )}
        </Card>
      </div>

      {/* ── Temporadas ── */}
      <div className="proto-grid2">
        <Card
          title="🏆 Comparativa por temporadas deportivas"
          hint="Pagos exitosos, bajas y pico mensual de activos por temporada deportiva (1 de septiembre a 31 de agosto), y el neto en USD de liquidación convertido por día. Una temporada con menos de 12 meses en el rango se marca con * y la que sigue en curso con ⏳."
          desc={
            <>
              Cada temporada va del <b>1 de septiembre</b> al <b>31 de agosto</b> del año siguiente. Se comparan transacciones (eventos), suscriptores activos (pico mensual de personas únicas en la temporada), bajas e ingresos netos en USD. Las temporadas aún en curso se marcan con ⏳; las parcialmente incluidas en el rango, con *.
            </>
          }
        >
          {seasons.length === 0 ? (
            <div className="no-data">Sin datos</div>
          ) : (
            <SeasonsChart
              labels={seasons.map((s) => s.label)}
              tx={seasons.map((s) => s.tx)}
              activePeak={seasons.map((s) => s.activePeak)}
              bajas={seasons.map((s) => s.bajas)}
              netUsd={seasons.map((s) => Math.round(s.netUsd))}
              footers={seasons.map((s) => s.footer)}
            />
          )}
        </Card>
        <Card
          title="📊 Transacciones por plan · Mensual vs Anual"
          hint="Pagos de suscripción exitosos de cada mes (sin partido único) por Período del Pago: mensual o anual. Es un conteo de Pagos, no de suscriptores."
          desc={
            <>
              Histórico mensualizado de transacciones de suscripción por tipo de plan (excluye partidos únicos y bajas). Las barras apiladas muestran cuántas transacciones fueron de planes <b>mensuales</b> y cuántas de planes <b>anuales</b> cada mes.
            </>
          }
        >
          {mList.length === 0 ? (
            <div className="no-data">Sin datos</div>
          ) : (
            <PlansFreqChart labels={mList} mensual={mList.map((x) => bk(x)?.mensual ?? 0)} anual={mList.map((x) => bk(x)?.anual ?? 0)} />
          )}
        </Card>
      </div>

      {/* ── Tabla mes × temporada ── */}
      <Card
        title="📅 Comparativa mensual por temporadas"
        hint="Cada celda es el valor del mes en la métrica elegida: Pagos por Período o por clasificación, activos al cierre, bajas, neto en USD (liquidación, convertido por día) o neto en la moneda de liquidación dominante. Las columnas son temporadas sep→ago; % Incremento compara contra el mes inmediatamente anterior en el tiempo."
        desc={
          <>
            Cada columna es una temporada deportiva (1 de septiembre a 31 de agosto). Las filas son los 12 meses en orden de temporada (sep → ago). El <b>% Incremento</b> compara cada celda con el <b>mes inmediatamente anterior en el tiempo</b>: octubre vs septiembre de la misma temporada, septiembre vs agosto de la temporada anterior, etc. La fila <b>Total</b> compara la suma de la temporada con la suma de la temporada previa. Respeta los filtros y el rango de arriba.
          </>
        }
      >
        <div className="proto-controls">
          <label>
            Métrica a comparar
            <select value={seasonMetric} onChange={(e) => setSeasonMetric(e.target.value as SeasonMetric)} style={{ minWidth: 260 }}>
              {SEASON_METRICS.map((x) => (
                <option key={x.key} value={x.key}>{x.label}</option>
              ))}
            </select>
          </label>
          <label>
            País
            <select disabled value="" style={{ minWidth: 220 }}>
              <option value="">{countryLabel}</option>
            </select>
          </label>
        </div>
        <div className="proto-table-scroll" style={{ maxHeight: 520 }}>
          {!seasonTable ? (
            <table className="tbl-seasons"><tbody><tr><td>Sin datos</td></tr></tbody></table>
          ) : (
            <SeasonTable t={seasonTable} countryLabel={countryLabel} />
          )}
        </div>
      </Card>

      {/* ── Comisiones ── */}
      <Card
        title="💳 Comisiones de pasarela"
        hint="Comisión de cada Proveedor por mes (por fecha de captura), convertida a USD con la cotización de cada día. Sólo comisión: la retención de MercadoPago no es un fee. El «% efectivo» de arriba es comisión ÷ bruto liquidado."
        desc="Fees cobrados por MercadoPago y Stripe mes a mes, en USD. PayPal no tiene feed de comisiones y no aparece."
      >
        {mList.length === 0 ? (
          <div className="no-data">Sin comisiones en rango</div>
        ) : (
          <FeesChart labels={mList} byPlatform={feesByGw} />
        )}
      </Card>

      {/* ── Ingresos mes a mes ── */}
      <Card
        title="Ingresos mes a mes"
        hint="Bruto y neto de liquidación por mes y moneda según el feed de comisiones de cada Proveedor. BRUTO USD y NETO USD son la suma de todo convertido a USD día por día; un mes con algún día sin cotización queda ausente en esas dos columnas."
        desc={
          <>
            Bruto vs neto por mes. Bruto = lo que el Proveedor liquidó. Neto = lo que queda después de los fees y la retención de la pasarela. El dashboard usa el <b>neto</b> como referencia principal.
          </>
        }
        foot={
          <>
            Conversión a USD por día: ARS al blue venta de dolarapi, USD sin convertir, EUR sin cotización (ausente).
            {data.grossOnlyPlatforms.length > 0 && <> {data.grossOnlyPlatforms.join(', ')} no aparece en esta tabla: sin feed de comisiones, contarlo con comisión cero lo haría parecer gratis.</>}
          </>
        }
      >
        <div className="proto-table-scroll" style={{ maxHeight: 420 }}>
          <table>
            <thead>
              <tr>
                <th>Mes</th>
                {mainCcys.map((c) => (
                  <SeasonCells key={c}>
                    <th className="right">Bruto {c} ({ccyPlatforms(c)})</th>
                    <th className="right">Neto {c} ({ccyPlatforms(c)})</th>
                  </SeasonCells>
                ))}
                <th className="right">Otras monedas (neto)</th>
                <th className="right">BRUTO USD</th>
                <th className="right">NETO USD</th>
              </tr>
            </thead>
            <tbody>
              {[...mList].map((x) => {
                const others = otherCcys
                  .map((c) => { const v = m.netLocal.get(c)?.get(x) ?? 0; return v > 0 ? `${c} ${fmt(Math.round(v))}` : ''; })
                  .filter(Boolean)
                  .join(' · ');
                const gU = m.grossUsd.get(x);
                const nU = m.netUsd.get(x);
                return (
                  <tr key={x}>
                    <td className="mono ink" style={{ fontWeight: 600 }}>{x}</td>
                    {mainCcys.map((c) => {
                      const gv = Math.round(m.grossLocal.get(c)?.get(x) ?? 0);
                      const nv = Math.round(m.netLocal.get(c)?.get(x) ?? 0);
                      return (
                        <SeasonCells key={c}>
                          <td className="right mono" style={{ color: '#94a3b8' }}>{gv ? fmt(gv) : '—'}</td>
                          <td className="right mono" style={{ color: c === 'ARS' ? '#0891b2' : '#1d4ed8', fontWeight: 600 }}>{nv ? fmt(nv) : '—'}</td>
                        </SeasonCells>
                      );
                    })}
                    <td className="right mono muted" style={{ fontSize: 11 }}>{others || '—'}</td>
                    <td className="right mono" style={{ color: '#94a3b8' }}>{gU && Math.round(gU) ? fmtUsdRound(gU) : '—'}</td>
                    <td className="right mono ink" style={{ fontWeight: 700 }}>{nU && Math.round(nU) ? fmtUsdRound(nU) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Detalle mensual ── */}
      <Card
        title="Detalle mensual"
        hint="Por mes: los Pagos exitosos clasificados (eventos), los Subscribers con acceso vigente al cierre del mes por Período (personas únicas) y el neto en USD de liquidación convertido por día. Bajas son Subscribers cuya cobertura venció ese mes sin renovación."
        desc={
          <>
            Las columnas <i>Nuevos</i> a <i>Partido único</i> son <b>transacciones</b> (eventos, no personas únicas — un mismo suscriptor puede aparecer varias veces al mes). Las columnas <i>Mensuales</i> y <i>Anuales</i> son <b>suscriptores activos únicos</b> al cierre del mes (cada persona cuenta una vez).
          </>
        }
      >
        <div className="proto-table-scroll" style={{ maxHeight: 480 }}>
          <table>
            <thead>
              <tr>
                <th rowSpan={2}>Mes</th>
                <th colSpan={6} style={{ textAlign: 'center' }}>Transacciones (eventos)</th>
                <th colSpan={3} style={{ textAlign: 'center', background: 'color-mix(in srgb, #10b981 12%, var(--p-thead))' }}>Suscriptores activos (únicos)</th>
                <th rowSpan={2} className="right">Ingreso neto USD</th>
              </tr>
              <tr>
                <th className="right" style={{ top: 37 }}>🟢 Nuevos</th>
                <th className="right" style={{ top: 37 }}>🔵 Recurrentes</th>
                <th className="right" style={{ top: 37 }}>🟡 Reactivados</th>
                <th className="right" style={{ top: 37 }}>🔴 Bajas</th>
                <th className="right" style={{ top: 37 }}>⚪️ Partido único</th>
                <th className="right" style={{ top: 37 }}>Total</th>
                <th className="right" style={{ top: 37 }}>📅 Mensuales</th>
                <th className="right" style={{ top: 37 }}>🗓️ Anuales</th>
                <th className="right" style={{ top: 37 }}>∑ Únicos</th>
              </tr>
            </thead>
            <tbody>
              {mList.map((x) => {
                const b = bk(x);
                const a = m.active.get(x);
                const totalEv = b ? b.newSubscribers + b.recurring + b.reactivated + b.churned + b.oneOff : 0;
                const nU = m.netUsd.get(x);
                return (
                  <tr key={x}>
                    <td className="mono ink" style={{ fontWeight: 600 }}>{x}{a?.partial ? ' ⏳' : ''}</td>
                    <td className="right" style={{ color: '#059669', fontWeight: 600 }}>{fmt(b?.newSubscribers ?? 0)}</td>
                    <td className="right">{fmt(b?.recurring ?? 0)}</td>
                    <td className="right" style={{ color: '#d97706', fontWeight: 600 }}>{fmt(b?.reactivated ?? 0)}</td>
                    <td className="right" style={{ color: '#dc2626', fontWeight: 600 }}>{fmt(b?.churned ?? 0)}</td>
                    <td className="right">{fmt(b?.oneOff ?? 0)}</td>
                    <td className="right"><b>{fmt(totalEv)}</b></td>
                    <td className="right cell-blue">{a?.mensual ? fmt(a.mensual) : '—'}</td>
                    <td className="right cell-amber">{a?.anual ? fmt(a.anual) : '—'}</td>
                    <td className="right cell-green">{a?.total ? fmt(a.total) : '—'}</td>
                    <td className="right mono ink" style={{ fontWeight: 700 }}>{nU && Math.round(nU) ? fmtUsdRound(nU) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Catálogo ── */}
      <details className="proto-details" open>
        <summary>
          Catálogo de precios inferido por plan, mercado y temporada
        </summary>
        <div style={{ marginTop: 14 }}>
          <div className="proto-note-box">
            <span className="ico">⚠️</span>
            <div>
              <b>Precios detectados directamente desde las transacciones.</b> Si ves varios precios en el mismo plan/temporada/mercado, puede ser por cambios de tarifa, descuentos, o errores de catálogo. Revisa los que no deberían estar.
            </div>
          </div>
          {catalog && (
            <>
              <div className="proto-controls">
                <label>
                  Mercado
                  <select value={cat.market} onChange={(e) => setCat({ ...cat, market: e.target.value })} style={{ minWidth: 200 }}>
                    <option value="ALL">Todos los mercados</option>
                    {catalog.markets.map((x) => <option key={x} value={x}>{MARKET_LABEL[x] ?? x}</option>)}
                  </select>
                </label>
                <label>
                  Temporada
                  <select value={cat.season} onChange={(e) => setCat({ ...cat, season: e.target.value })}>
                    <option value="ALL">Todas las temporadas</option>
                    {catalog.seasons.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
                <label>
                  Plan
                  <select value={cat.plan} onChange={(e) => setCat({ ...cat, plan: e.target.value })} style={{ minWidth: 200 }}>
                    <option value="ALL">Todos los planes</option>
                    {catalog.plans.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </label>
                <label>
                  Moneda
                  <select value={cat.currency} onChange={(e) => setCat({ ...cat, currency: e.target.value })} style={{ minWidth: 140 }}>
                    <option value="ALL">Todas las monedas</option>
                    {catalog.currencies.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
                <label>
                  Precio
                  <select value={catalog.prices.some((p) => `${p.currency}|${p.price}` === cat.price) ? cat.price : 'ALL'} onChange={(e) => setCat({ ...cat, price: e.target.value })} style={{ minWidth: 180 }}>
                    <option value="ALL">Todos los precios</option>
                    {catalog.prices.map((p) => (
                      <option key={`${p.currency}|${p.price}`} value={`${p.currency}|${p.price}`}>
                        {cat.currency === 'ALL' ? `${p.currency} ` : ''}{p.price.toLocaleString('es')} ({p.count.toLocaleString('es')} tx)
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="proto-table-scroll" style={{ maxHeight: 520 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Plan</th><th>Mercado</th><th>Moneda</th><th>Temporada</th>
                      <th className="right">Precio</th><th className="right">Transacciones</th><th>Ranking</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.rows.length === 0 ? (
                      <tr><td colSpan={7} style={{ textAlign: 'center', padding: 30 }} className="muted">Sin entradas para este filtro.</td></tr>
                    ) : (
                      catalog.rows.map((r) => (
                        <tr key={`${r.planFamily}|${r.planFrequency}|${r.market}|${r.season}|${r.currency}|${r.price}`}>
                          <td className="ink" style={{ fontWeight: 600 }}>{r.planFamily} · {r.planFrequency}</td>
                          <td><span className="proto-tag-market">{r.market}</span></td>
                          <td>{r.currency}</td>
                          <td>{r.season}</td>
                          <td className="right mono">{r.price.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="right">{fmt(r.txCount)}</td>
                          <td>{r.rank === 1 ? <span className="pill recurring" style={{ margin: 0 }}>★ principal</span> : <span className="muted">#{r.rank}</span>}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </details>

      {/* ── Asistente ── */}
      <Card
        title="💬 Asistente de datos"
        hint="Preguntas en lenguaje natural sobre los datos de esta pantalla. Todavía no está conectado a la base viva."
        desc="Preguntas sobre los datos del dashboard en lenguaje natural: ingresos por Proveedor y moneda, activos, transacciones, comisiones, precios."
      >
        <Pending kind="asistente">
          El asistente del prototipo respondía sobre una copia de los datos embebida y congelada. Contra la base viva necesita una superficie de consulta propia, y cada número que citaría sale de los bloques de arriba: es lo último de la portación, no lo primero.
        </Pending>
      </Card>
    </div>
  );
}

/** La tabla mes × temporada del prototipo: cabecera con país y métrica, una
 *  columna por temporada con su «% Incremento», y las filas Total y Media. */
function SeasonTable({
  t,
  countryLabel,
}: {
  t: {
    seasonKeys: number[];
    values: Map<number, Map<number, number | null>>;
    totals: Map<number, number>;
    counts: Map<number, number>;
    fmtVal: (v: number) => string;
    title: string;
    invert: boolean;
  };
  countryLabel: string;
}) {
  const pickCls = (isPositive: boolean): 'up' | 'down' => (t.invert ? (isPositive ? 'down' : 'up') : isPositive ? 'up' : 'down');
  const fmtPct = (cur: number, prev: number | null | undefined): { cls: string; txt: string } => {
    if (prev === null || prev === undefined) return { cls: 'na', txt: '' };
    if (prev === 0) return cur === 0 ? { cls: 'na', txt: '—' } : { cls: pickCls(true), txt: '+∞' };
    const pct = ((cur - prev) / prev) * 100;
    return { cls: pickCls(pct >= 0), txt: `${pct >= 0 ? '+' : ''}${pct.toFixed(2).replace('.', ',')}%` };
  };
  const cell = (v: number | null, prev: number | null | undefined) =>
    v === null ? (
      <>
        <td className="none">—</td>
        <td className="pct na" />
      </>
    ) : (
      <>
        <td className="num">{t.fmtVal(v)}</td>
        <td className={`pct ${fmtPct(v, prev).cls}`}>{fmtPct(v, prev).txt}</td>
      </>
    );

  // Cada total se compara con el de la temporada anterior que tenga datos:
  // se recorre una vez y se arrastra el previo, sin reasignar en el render.
  const totalCells = t.seasonKeys.reduce<{ prev: number | null; out: React.ReactNode[] }>(
    (acc, s) => {
      const has = (t.counts.get(s) ?? 0) > 0;
      const tot = t.totals.get(s) ?? 0;
      acc.out.push(<SeasonCells key={s}>{has ? cell(tot, acc.prev) : cell(null, null)}</SeasonCells>);
      return { prev: has ? tot : null, out: acc.out };
    },
    { prev: null, out: [] },
  ).out;
  const avgCells = t.seasonKeys.reduce<{ prev: number | null; out: React.ReactNode[] }>(
    (acc, s) => {
      const n = t.counts.get(s) ?? 0;
      if (n === 0) {
        acc.out.push(<SeasonCells key={s}>{cell(null, null)}</SeasonCells>);
        return { prev: null, out: acc.out };
      }
      const avg = (t.totals.get(s) ?? 0) / n;
      acc.out.push(<SeasonCells key={s}>{cell(Math.round(avg * 100) / 100, acc.prev)}</SeasonCells>);
      return { prev: avg, out: acc.out };
    },
    { prev: null, out: [] },
  ).out;

  return (
    <table className="tbl-seasons">
      <thead>
        <tr>
          <th className="country-cell">{countryLabel}</th>
          <th className="metric-title" colSpan={t.seasonKeys.length * 2}>{t.title}</th>
        </tr>
        <tr>
          <th style={{ top: 33 }} />
          {t.seasonKeys.map((s) => (
            <SeasonCells key={s}>
              <th className="season" style={{ top: 33 }}>{seasonLabel(s)}</th>
              <th className="pcth" style={{ top: 33 }}>% Incremento</th>
            </SeasonCells>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr className="summary"><td>Total</td>{totalCells}</tr>
        {SEASON_MONTH_ORDER.map((mo, idx) => (
          <tr key={mo}>
            <td>{MONTH_FULL_ES[mo]}</td>
            {t.seasonKeys.map((s) => {
              const v = t.values.get(s)?.get(mo) ?? null;
              const prev = idx === 0 ? (t.values.get(s - 1)?.get(8) ?? null) : (t.values.get(s)?.get(SEASON_MONTH_ORDER[idx - 1]) ?? null);
              return <SeasonCells key={s}>{cell(v, prev)}</SeasonCells>;
            })}
          </tr>
        ))}
        <tr className="summary"><td>Media</td>{avgCells}</tr>
      </tbody>
    </table>
  );
}

/** Un par de celdas con una sola key: React quiere una por hijo del array. */
function SeasonCells({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
