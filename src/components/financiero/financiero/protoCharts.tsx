'use client';
import { useMemo } from 'react';
import type { ChartConfiguration, ChartDataset } from 'chart.js';
import { ChartCanvas } from '@/components/charts/ChartCanvas';
import { useChartTheme, type ChartTheme } from '@/lib/client/theme';
import { tooltipBase } from '@/components/charts/tooltip';
import { fmt, fmtUsd } from './format';

/**
 * Los gráficos de `public/dashboard.html`, configuración por configuración.
 *
 * Cada componente transcribe el `new Chart(...)` del prototipo: los mismos
 * colores, grosores, radios, ejes y leyendas. Lo único que cambia con el tema
 * es lo que el canvas no puede leer de una variable CSS: el color de rejilla y
 * el fondo del tooltip. El prototipo es claro; en oscuro se usa la paleta del
 * tema para esas dos cosas y nada más.
 */

const INTER = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function grid(t: ChartTheme): string {
  return t.theme === 'light' ? 'rgba(15,23,42,0.06)' : t.grid;
}
function gridSoft(t: ChartTheme): string {
  return t.theme === 'light' ? '#f1f5f9' : t.grid;
}
function ink(t: ChartTheme): string {
  return t.theme === 'light' ? '#0f172a' : '#e8edf5';
}
function base() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    font: { family: INTER },
  } as const;
}
function tooltip(t: ChartTheme, callbacks?: Record<string, unknown>) {
  return { ...tooltipBase(t), ...(callbacks ? { callbacks } : {}) };
}
const legendBottom = (extra?: Record<string, unknown>) => ({
  position: 'bottom' as const,
  labels: { boxWidth: 12, padding: 12, font: { weight: 500 as const }, ...extra },
});

function Canvas({ config, height }: { config: ChartConfiguration; height: number }) {
  return <ChartCanvas config={config} height={height} />;
}

// ── 📈 Vista consolidada ────────────────────────────────────────────────────
export function CombinedChart({
  labels,
  usd,
  active,
  tx,
  height = 360,
}: {
  labels: string[];
  usd: number[];
  active: number[];
  tx: number[];
  height?: number;
}) {
  const t = useChartTheme();
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar', label: 'Ingresos netos (USD)', data: usd,
            backgroundColor: 'rgba(5,150,105,0.55)', borderColor: '#059669', borderWidth: 1,
            borderRadius: 4, yAxisID: 'yUsd', order: 3,
          },
          {
            type: 'line', label: 'Suscriptores activos', data: active,
            borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.12)',
            yAxisID: 'yCount', tension: 0.3, borderWidth: 3, pointRadius: 3, pointHoverRadius: 6, fill: false, order: 1,
          },
          {
            type: 'line', label: 'Transacciones', data: tx,
            borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.12)',
            yAxisID: 'yCount', tension: 0.3, borderWidth: 3, pointRadius: 3, pointHoverRadius: 6, borderDash: [6, 3], fill: false, order: 2,
          },
        ] as ChartDataset[],
      },
      options: {
        ...base(),
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: legendBottom({ padding: 14, usePointStyle: true }),
          tooltip: tooltip(t, {
            label: (ctx: { dataset: { label?: string; yAxisID?: string }; parsed: { y: number } }) =>
              ctx.dataset.yAxisID === 'yUsd'
                ? `${ctx.dataset.label}: $${fmt(ctx.parsed.y)}`
                : `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
          }),
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } },
          yUsd: {
            position: 'left', beginAtZero: true, grid: { color: grid(t) },
            ticks: { callback: (v) => `$${fmt(Number(v))}`, color: '#059669' },
            title: { display: true, text: 'Ingresos netos USD', color: '#059669', font: { size: 11, weight: 600 } },
          },
          yCount: {
            position: 'right', beginAtZero: true, grid: { display: false },
            ticks: { callback: (v) => fmt(Number(v)), color: '#3b82f6' },
            title: { display: true, text: 'Activos / Transacciones', color: '#3b82f6', font: { size: 11, weight: 600 } },
          },
        },
      },
    }),
    [labels, usd, active, tx, t],
  );
  return <Canvas config={config} height={height} />;
}

// ── 📅 Últimos 15 días — altas, reactivados, bajas y netas ─────────────────
export function Daily15Chart({
  labels,
  titles,
  nuevas,
  reactivados,
  bajas,
  netas,
  height = 360,
}: {
  labels: string[];
  titles: string[];
  nuevas: number[];
  reactivados: number[];
  bajas: number[];
  netas: number[];
  height?: number;
}) {
  const t = useChartTheme();
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Altas nuevas', data: nuevas, backgroundColor: '#10b981', borderColor: '#059669', borderWidth: 0, borderRadius: 4, maxBarThickness: 32, stack: 'pos', order: 3 },
          { type: 'bar', label: 'Reactivados', data: reactivados, backgroundColor: '#f59e0b', borderColor: '#d97706', borderWidth: 0, borderRadius: 4, maxBarThickness: 32, stack: 'pos', order: 3 },
          { type: 'bar', label: 'Bajas', data: bajas.map((v) => -v), backgroundColor: '#ef4444', borderColor: '#dc2626', borderWidth: 0, borderRadius: 4, maxBarThickness: 32, stack: 'neg', order: 3 },
          {
            type: 'line', label: 'Netas (altas + react − bajas)', data: netas,
            borderColor: '#1e3a8a', backgroundColor: 'rgba(30,58,138,0.10)',
            tension: 0.25, borderWidth: 3, pointRadius: 4, pointHoverRadius: 7,
            pointBackgroundColor: '#1e3a8a', pointBorderColor: '#fff', pointBorderWidth: 2, fill: false, order: 1,
          },
        ] as ChartDataset[],
      },
      options: {
        ...base(),
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: legendBottom({ padding: 14, usePointStyle: true }),
          tooltip: tooltip(t, {
            title: (items: { dataIndex: number; label: string }[]) => titles[items[0]?.dataIndex] ?? items[0]?.label,
            label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
              `${ctx.dataset.label}: ${fmt(Math.abs(ctx.parsed.y))}`,
          }),
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false } },
          y: { grid: { color: grid(t) }, ticks: { callback: (v) => fmt(Math.abs(Number(v))) } },
        },
      },
    }),
    [labels, titles, nuevas, reactivados, bajas, netas, t],
  );
  return <Canvas config={config} height={height} />;
}

// ── 👥 Últimos 15 días — suscriptores activos vigentes ─────────────────────
export function DailyActive15Chart({
  labels,
  titles,
  active,
  height = 300,
}: {
  labels: string[];
  titles: string[];
  active: number[];
  height?: number;
}) {
  const t = useChartTheme();
  const config = useMemo<ChartConfiguration>(() => {
    // Para que las diferencias diarias se vean, el eje se ancla cerca del mínimo.
    const min = active.length ? Math.min(...active) : 0;
    const max = active.length ? Math.max(...active) : 0;
    const pad = Math.max(50, Math.round((max - min) * 0.25));
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Suscriptores activos vigentes', data: active, backgroundColor: '#1e3a8a', borderColor: '#1e40af', borderWidth: 0, borderRadius: 4, maxBarThickness: 42 },
        ],
      },
      options: {
        ...base(),
        plugins: {
          legend: { display: false },
          tooltip: tooltip(t, {
            title: (items: { dataIndex: number; label: string }[]) => titles[items[0]?.dataIndex] ?? items[0]?.label,
            label: (ctx: { parsed: { y: number } }) => `Activos: ${fmt(ctx.parsed.y)}`,
          }),
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: false } },
          y: { min: Math.max(0, min - pad), max: max + pad, grid: { color: grid(t) }, ticks: { callback: (v) => fmt(Number(v)) } },
        },
      },
    };
  }, [labels, titles, active, t]);
  return <Canvas config={config} height={height} />;
}

// ── Transacciones mensuales ─────────────────────────────────────────────────
export function FlowChart({
  labels,
  recurring,
  nuevos,
  reactivados,
  oneOff,
  bajas,
  height = 300,
}: {
  labels: string[];
  recurring: number[];
  nuevos: number[];
  reactivados: number[];
  oneOff: number[];
  bajas: number[];
  height?: number;
}) {
  const t = useChartTheme();
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Recurrentes', data: recurring, backgroundColor: '#3b82f6', borderColor: '#1d4ed8', borderWidth: 0, stack: 'pos', borderRadius: 3, maxBarThickness: 28 },
          { label: 'Nuevos', data: nuevos, backgroundColor: '#10b981', borderColor: '#059669', borderWidth: 0, stack: 'pos', borderRadius: 3, maxBarThickness: 28 },
          { label: 'Reactivados', data: reactivados, backgroundColor: '#f59e0b', borderColor: '#d97706', borderWidth: 0, stack: 'pos', borderRadius: 3, maxBarThickness: 28 },
          { label: 'Partido único', data: oneOff, backgroundColor: '#94a3b8', borderColor: '#64748b', borderWidth: 0, stack: 'pos', borderRadius: 3, maxBarThickness: 28, hidden: true },
          { label: 'Bajas', data: bajas.map((v) => -v), backgroundColor: '#ef4444', borderColor: '#dc2626', borderWidth: 0, stack: 'neg', borderRadius: 3, maxBarThickness: 28 },
        ],
      },
      options: {
        ...base(),
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: legendBottom({ padding: 14, usePointStyle: true, pointStyle: 'rect' }),
          tooltip: tooltip(t, {
            label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
              `${ctx.dataset.label}: ${fmt(Math.abs(ctx.parsed.y))}`,
          }),
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } },
          y: { stacked: true, grid: { color: grid(t) }, ticks: { callback: (v) => fmt(Math.abs(Number(v))) } },
        },
      },
    }),
    [labels, recurring, nuevos, reactivados, oneOff, bajas, t],
  );
  return <Canvas config={config} height={height} />;
}

// ── Mix de planes ───────────────────────────────────────────────────────────
const PLAN_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b', '#ec4899', '#14b8a6'];
export function PlansDonut({ labels, values, height = 300 }: { labels: string[]; values: number[]; height?: number }) {
  const t = useChartTheme();
  const config = useMemo<ChartConfiguration>(() => {
    const total = values.reduce((a, b) => a + b, 0);
    return {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: PLAN_COLORS, borderColor: t.surface, borderWidth: 3 }] },
      options: {
        ...base(),
        cutout: '65%',
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, padding: 10, font: { size: 12, weight: 500 } } },
          tooltip: tooltip(t, {
            label: (ctx: { label: string; parsed: number }) =>
              `${ctx.label}: ${fmt(ctx.parsed)} (${total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0.0'}%)`,
          }),
        },
      },
    };
  }, [labels, values, t]);
  return <Canvas config={config} height={height} />;
}

// ── 📉 Cancelaciones por mes ────────────────────────────────────────────────
const GW_COLOR: Record<string, string> = { MercadoPago: '#06b6d4', Stripe: '#8b5cf6', PayPal: '#f59e0b' };
export function CancelMonthlyChart({
  labels,
  byPlatform,
  height = 340,
}: {
  labels: string[];
  byPlatform: { platformName: string; data: number[] }[];
  height?: number;
}) {
  const t = useChartTheme();
  const config = useMemo<ChartConfiguration>(() => {
    const total = labels.map((_, i) => byPlatform.reduce((a, p) => a + (p.data[i] ?? 0), 0));
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          ...byPlatform.map((p) => ({
            type: 'bar' as const,
            label: `${p.platformName} (${p.platformName === 'Stripe' ? 'canceled' : 'cancelled'})`,
            data: p.data, backgroundColor: GW_COLOR[p.platformName] ?? '#64748b', borderRadius: 3, stack: 'g', order: 3,
          })),
          {
            type: 'line' as const, label: 'Total cancelaciones', data: total,
            borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.10)',
            tension: 0.3, borderWidth: 2.5, pointRadius: 3, fill: false, order: 1,
          },
        ] as ChartDataset[],
      },
      options: {
        ...base(),
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: legendBottom({ padding: 14, usePointStyle: true }),
          tooltip: tooltip(t, {
            label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
          }),
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } },
          y: { stacked: true, grid: { color: grid(t) }, ticks: { callback: (v) => fmt(Number(v)) } },
        },
      },
    };
  }, [labels, byPlatform, t]);
  return <Canvas config={config} height={height} />;
}

// ── 📅 Activos por antigüedad del último cargo ──────────────────────────────
export const LC_BUCKETS = ['0-30', '31-60', '61-90', '91-180', '180+'] as const;
const LC_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#f97316', '#dc2626'];
export function LastChargeChart({ values, height = 280 }: { values: number[]; height?: number }) {
  const t = useChartTheme();
  const config = useMemo<ChartConfiguration>(() => {
    const total = values.reduce((a, b) => a + b, 0);
    return {
      type: 'bar',
      data: {
        labels: LC_BUCKETS.map((b) => `${b} días`),
        datasets: [{ label: 'Suscriptores activos', data: values, backgroundColor: LC_COLORS, borderRadius: 4, maxBarThickness: 60 }],
      },
      options: {
        ...base(),
        plugins: {
          legend: { display: false },
          tooltip: tooltip(t, {
            label: (ctx: { parsed: { y: number } }) =>
              `${fmt(ctx.parsed.y)} suscriptores · ${total > 0 ? ((ctx.parsed.y / total) * 100).toFixed(1) : '0'}% del total`,
          }),
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11.5, weight: 500 } } },
          y: { grid: { color: grid(t) }, ticks: { callback: (v) => fmt(Number(v)) } },
        },
      },
    };
  }, [values, t]);
  return <Canvas config={config} height={height} />;
}

// ── Ingresos netos por mes ──────────────────────────────────────────────────
const CUR_COLORS: Record<string, string> = { ARS: '#06b6d4', USD: '#3b82f6', UYU: '#10b981', CLP: '#f59e0b', BRL: '#8b5cf6', EUR: '#ec4899', BOB: '#64748b', PEN: '#14b8a6' };
export function RevenueChart({
  labels,
  byCurrency,
  totalUsd,
  height = 340,
}: {
  labels: string[];
  byCurrency: { currency: string; data: number[] }[];
  totalUsd: (number | null)[];
  height?: number;
}) {
  const t = useChartTheme();
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'line',
      data: {
        labels,
        datasets: [
          ...byCurrency.map((c) => ({
            label: `${c.currency} (neto)`, data: c.data,
            borderColor: CUR_COLORS[c.currency] ?? '#64748b',
            backgroundColor: `${CUR_COLORS[c.currency] ?? '#64748b'}20`,
            yAxisID: 'yLocal', tension: 0.35, borderWidth: 2.5, pointRadius: 2, pointHoverRadius: 5, fill: false,
          })),
          {
            label: 'TOTAL NETO USD (MP+Stripe)', data: totalUsd,
            borderColor: ink(t), backgroundColor: t.theme === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(232,237,245,0.08)',
            yAxisID: 'yUsd', borderDash: [6, 4], tension: 0.35, borderWidth: 2.5, pointRadius: 0, fill: true,
          },
        ] as ChartDataset[],
      },
      options: {
        ...base(),
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: legendBottom(), tooltip: tooltip(t) },
        scales: {
          x: { grid: { display: false } },
          yLocal: { position: 'left', grid: { color: gridSoft(t) }, ticks: { callback: (v) => fmt(Number(v)) }, title: { display: true, text: 'Moneda local', color: '#94a3b8', font: { size: 11 } } },
          yUsd: { position: 'right', grid: { display: false }, ticks: { callback: (v) => `$${fmt(Number(v))}`, color: ink(t) }, title: { display: true, text: 'USD', color: ink(t), font: { size: 11, weight: 600 } } },
        },
      },
    }),
    [labels, byCurrency, totalUsd, t],
  );
  return <Canvas config={config} height={height} />;
}

// ── Suscriptores activos reales ─────────────────────────────────────────────
export function ActiveChart({
  labels,
  mensual,
  anual,
  total,
  height = 340,
}: {
  labels: string[];
  mensual: number[];
  anual: number[];
  total: number[];
  height?: number;
}) {
  const t = useChartTheme();
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Mensuales (activos)', data: mensual, backgroundColor: '#3b82f6', stack: 'active', borderRadius: 4, yAxisID: 'y' },
          { type: 'bar', label: 'Anuales (activos)', data: anual, backgroundColor: '#f59e0b', stack: 'active', borderRadius: 4, yAxisID: 'y' },
          {
            type: 'line', label: 'Total únicos (dedup. mensual+anual)', data: total,
            borderColor: ink(t), backgroundColor: 'rgba(15,23,42,0.05)',
            borderDash: [5, 4], tension: 0.35, borderWidth: 2.5, pointRadius: 2, pointHoverRadius: 5, fill: false, yAxisID: 'y',
          },
        ] as ChartDataset[],
      },
      options: {
        ...base(),
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: legendBottom(),
          tooltip: tooltip(t, {
            footer: (items: { dataIndex: number }[]) => {
              const i = items[0]?.dataIndex ?? -1;
              const dual = (mensual[i] ?? 0) + (anual[i] ?? 0) - (total[i] ?? 0);
              return dual > 0 ? `(${fmt(dual)} suscriptores con plan mensual + anual)` : '';
            },
          }),
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: gridSoft(t) }, ticks: { callback: (v) => fmt(Number(v)) } },
        },
      },
    }),
    [labels, mensual, anual, total, t],
  );
  return <Canvas config={config} height={height} />;
}

// ── 🏆 Comparativa por temporadas deportivas ────────────────────────────────
export function SeasonsChart({
  labels,
  tx,
  activePeak,
  bajas,
  netUsd,
  footers,
  height = 340,
}: {
  labels: string[];
  tx: number[];
  activePeak: number[];
  bajas: number[];
  netUsd: number[];
  footers: string[];
  height?: number;
}) {
  const t = useChartTheme();
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Transacciones', data: tx, backgroundColor: '#3b82f6', yAxisID: 'yL', borderRadius: 4, order: 2 },
          { type: 'bar', label: 'Activos (pico)', data: activePeak, backgroundColor: '#8b5cf6', yAxisID: 'yL', borderRadius: 4, order: 2 },
          { type: 'bar', label: 'Bajas', data: bajas, backgroundColor: '#ef4444', yAxisID: 'yL', borderRadius: 4, order: 2 },
          {
            type: 'line', label: 'Ingresos netos USD', data: netUsd,
            borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.15)',
            yAxisID: 'yR', tension: 0.3, borderWidth: 3, pointRadius: 5, pointHoverRadius: 7, fill: false, order: 1,
          },
        ] as ChartDataset[],
      },
      options: {
        ...base(),
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: legendBottom(),
          tooltip: tooltip(t, {
            footer: (items: { dataIndex: number }[]) => footers[items[0]?.dataIndex ?? -1] ?? '',
            label: (ctx: { dataset: { label?: string; yAxisID?: string }; parsed: { y: number } }) =>
              ctx.dataset.yAxisID === 'yR' ? `${ctx.dataset.label}: ${fmtUsd(ctx.parsed.y)}` : `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
          }),
        },
        scales: {
          x: { grid: { display: false } },
          yL: { position: 'left', grid: { color: gridSoft(t) }, ticks: { callback: (v) => fmt(Number(v)) }, title: { display: true, text: 'Transacciones · Activos', color: '#94a3b8', font: { size: 11 } } },
          yR: { position: 'right', grid: { display: false }, ticks: { callback: (v) => `$${fmt(Number(v))}`, color: '#059669' }, title: { display: true, text: 'Ingresos netos USD', color: '#059669', font: { size: 11, weight: 600 } } },
        },
      },
    }),
    [labels, tx, activePeak, bajas, netUsd, footers, t],
  );
  return <Canvas config={config} height={height} />;
}

// ── 📊 Transacciones por plan · Mensual vs Anual ────────────────────────────
export function PlansFreqChart({
  labels,
  mensual,
  anual,
  height = 340,
}: {
  labels: string[];
  mensual: number[];
  anual: number[];
  height?: number;
}) {
  const t = useChartTheme();
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Mensual', data: mensual, backgroundColor: '#2563eb', borderRadius: 3, stack: 'tx' },
          { label: 'Anual', data: anual, backgroundColor: '#d97706', borderRadius: 3, stack: 'tx' },
        ],
      },
      options: {
        ...base(),
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: legendBottom(),
          tooltip: tooltip(t, {
            footer: (items: { dataIndex: number }[]) => {
              const i = items[0]?.dataIndex ?? -1;
              const mm = mensual[i] ?? 0;
              const aa = anual[i] ?? 0;
              const tot = mm + aa;
              if (!tot) return '';
              return `Total: ${fmt(tot)} · Mensual ${((mm / tot) * 100).toFixed(1)}% · Anual ${((aa / tot) * 100).toFixed(1)}%`;
            },
          }),
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } },
          y: { stacked: true, beginAtZero: true, grid: { color: gridSoft(t) }, ticks: { callback: (v) => fmt(Number(v)) }, title: { display: true, text: 'Transacciones de suscripción', color: '#94a3b8', font: { size: 11 } } },
        },
      },
    }),
    [labels, mensual, anual, t],
  );
  return <Canvas config={config} height={height} />;
}

// ── 💳 Comisiones de pasarela ───────────────────────────────────────────────
export function FeesChart({
  labels,
  byPlatform,
  height = 340,
}: {
  labels: string[];
  byPlatform: { platformName: string; data: number[] }[];
  height?: number;
}) {
  const t = useChartTheme();
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels,
        datasets: byPlatform.map((p) => ({
          label: `Fee ${p.platformName === 'MercadoPago' ? 'MP' : p.platformName} (USD)`,
          data: p.data,
          backgroundColor: GW_COLOR[p.platformName] ?? '#64748b',
          stack: 'fees',
          borderRadius: 4,
        })),
      },
      options: {
        ...base(),
        plugins: {
          legend: legendBottom(),
          tooltip: tooltip(t, {
            label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) => `${ctx.dataset.label}: ${fmtUsd(ctx.parsed.y)}`,
          }),
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: gridSoft(t) }, ticks: { callback: (v) => `$${fmt(Number(v))}` } },
        },
      },
    }),
    [labels, byPlatform, t],
  );
  return <Canvas config={config} height={height} />;
}
