'use client';
import type { ReactNode } from 'react';
import { InfoHint } from '@/components/ui/InfoHint';

/**
 * Las piezas del prototipo, una a una: tarjeta con `h2` + `.desc`, KPI con
 * icono y desglose, columna del snapshot, etiqueta de sección. La forma y el
 * orden son los de `public/dashboard.html`; lo único que se agrega es el "?"
 * al lado de cada título, que explica qué mide el número.
 */

export function Card({
  title,
  note,
  hint,
  desc,
  foot,
  children,
}: {
  title: ReactNode;
  /** Aclaración corta al lado del título, como el país activo o el «hasta el». */
  note?: ReactNode;
  /** Una frase que explica qué mide el gráfico. Se muestra al pasar por el "?". */
  hint?: ReactNode;
  /** La descripción larga que el prototipo pone *antes* del gráfico. */
  desc?: ReactNode;
  foot?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="card min-w-0 p-5">
      <h2 className="card-title flex flex-wrap items-center gap-x-2">
        <span className="inline-flex items-center">
          {title}
          {hint && <InfoHint text={hint} />}
        </span>
        {note && <span className="font-sans text-xs font-medium tracking-normal text-muted normal-case">{note}</span>}
      </h2>
      {desc && <div className="card-desc mb-4 [&_code]:font-mono [&_code]:text-[11px]">{desc}</div>}
      {children}
      {foot && <div className="mt-3.5 text-[11px] text-muted italic">{foot}</div>}
    </section>
  );
}

/** La etiqueta que separa bloques de KPIs. `first` quita el margen de arriba. */
export function SectionLabel({ children, first }: { children: ReactNode; first?: boolean }) {
  return <div className={`eyebrow flex items-center gap-1.5 px-0.5 ${first ? '' : 'mt-2'}`}>{children}</div>;
}

export type KpiTone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate';

// La barra de arriba, el fondo del icono y el color de la cifra, por tono.
const TONE: Record<KpiTone, { bar: string; soft: string; ink: string }> = {
  blue: { bar: 'before:bg-blue-600', soft: 'bg-blue-50', ink: 'text-blue-700' },
  green: { bar: 'before:bg-[var(--ok)]', soft: 'bg-[var(--ok-soft)]', ink: 'text-[var(--ok)]' },
  amber: { bar: 'before:bg-amber-500', soft: 'bg-amber-50', ink: 'text-amber-700' },
  red: { bar: 'before:bg-accent', soft: 'bg-accent-soft', ink: 'text-accent-strong' },
  purple: { bar: 'before:bg-violet-600', soft: 'bg-violet-50', ink: 'text-violet-700' },
  slate: { bar: 'before:bg-n-400', soft: 'bg-n-100', ink: 'text-foreground' },
};

/** La tarjeta KPI del prototipo: barra de color, icono, título, número y un
 *  subtítulo que puede traer el desglose (`<Breakdown>`). */
export function Kpi({
  tone,
  icon,
  title,
  value,
  hint,
  children,
}: {
  tone: KpiTone;
  icon: string;
  title: string;
  value: ReactNode;
  hint?: ReactNode;
  /** El `.s` del prototipo: texto corto y, debajo, el desglose. */
  children?: ReactNode;
}) {
  return (
    <div
      className={`card relative overflow-hidden p-5 before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:content-[''] ${TONE[tone].bar}`}
    >
      <div className={`mb-3 flex size-10 items-center justify-center rounded-[var(--panel-radius)] text-xl ${TONE[tone].soft}`}>
        {icon}
      </div>
      <h3 className="eyebrow mb-1.5 flex items-center">
        {title}
        {hint && <InfoHint text={hint} />}
      </h3>
      <div className={`figure ${TONE[tone].ink}`}>{value}</div>
      <div className="mt-2 text-xs font-medium text-muted">{children}</div>
    </div>
  );
}

export interface BreakdownRow {
  swatch: string;
  label: string;
  value: string;
  /** Porcentaje ya formateado, o nada. */
  pct?: string;
  color?: string;
  /** Una línea encima: el prototipo separa las bajas del resto del flujo. */
  sep?: boolean;
}

export function Breakdown({ rows }: { rows: (BreakdownRow | { head: string })[] }) {
  return (
    <div className="mt-2.5 flex flex-col gap-1.5 border-t border-[var(--border)] pt-2.5 text-[13px]">
      {rows.map((r, i) =>
        'head' in r ? (
          <div className="eyebrow mt-1 border-t border-[var(--border)] pt-1.5" key={i}>
            {r.head}
          </div>
        ) : (
          <div
            className={`flex items-center justify-between gap-2 ${r.sep ? 'mt-1 border-t border-[var(--border)] pt-1.5' : ''}`}
            key={i}
          >
            <span className="flex items-center gap-1.5 text-n-700">
              <span className="inline-block size-2 rounded-[2px]" style={{ background: r.swatch }} />
              {r.label}
            </span>
            <span>
              <span className="font-semibold text-foreground tabular-nums" style={r.color ? { color: r.color } : undefined}>
                {r.value}
              </span>
              {r.pct !== undefined && <span className="ml-1 text-[11px] font-medium text-muted">{r.pct}</span>}
            </span>
          </div>
        ),
      )}
    </div>
  );
}

/** La variación de un valor contra el período anterior, como la pinta el prototipo. */
export interface Delta {
  cls: 'up' | 'down' | 'flat';
  arrow: string;
  pctStr: string;
}

export function delta(cur: number, prev: number, invert = false): Delta {
  const diff = cur - prev;
  const flat = Math.abs(diff) < 1e-6;
  const pct = prev !== 0 ? (diff / prev) * 100 : null;
  const cls: Delta['cls'] = flat ? 'flat' : invert ? (diff > 0 ? 'down' : 'up') : diff > 0 ? 'up' : 'down';
  const arrow = flat ? '—' : diff > 0 ? '▲' : '▼';
  const pctStr =
    pct === null
      ? flat
        ? ''
        : 'nuevo'
      : `${diff > 0 ? '+' : ''}${pct.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  return { cls, arrow, pctStr };
}

const MS_TONE: Record<'tx' | 'active' | 'revenue', { bar: string; ink: string }> = {
  tx: { bar: 'before:bg-blue-600', ink: 'text-blue-700' },
  active: { bar: 'before:bg-violet-600', ink: 'text-violet-700' },
  revenue: { bar: 'before:bg-[var(--ok)]', ink: 'text-[var(--ok)]' },
};

/** El color de una variación: verde si mejora, rojo si empeora. */
export const DELTA_TAG: Record<Delta['cls'], string> = { up: 'tag-ok', down: 'tag-bad', flat: 'tag-neutral' };
export const DELTA_INK: Record<Delta['cls'], string> = {
  up: 'text-[var(--ok)]',
  down: 'text-accent-strong',
  flat: 'text-muted',
};

/** Una de las tres columnas del snapshot. */
export function MsCol({
  tone,
  title,
  hint,
  big,
  bigDelta,
  rows,
  foot,
}: {
  tone: 'tx' | 'active' | 'revenue';
  title: string;
  hint?: ReactNode;
  big: string;
  bigDelta: { d: Delta; prev: string };
  rows: ({ swatch: string; label: string; value: string; d: Delta } | { head: string })[];
  /** Una línea al pie, en cursiva y gris: lo que la cifra grande deja afuera. */
  foot?: ReactNode;
}) {
  return (
    <div
      className={`card relative overflow-hidden px-5 py-4.5 before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:content-[''] ${MS_TONE[tone].bar}`}
    >
      <h4 className="eyebrow mb-1 flex items-center">
        {title}
        {hint && <InfoHint text={hint} />}
      </h4>
      <div className={`figure mt-1 ${MS_TONE[tone].ink}`}>{big}</div>
      <div className={`tag mt-2 ${DELTA_TAG[bigDelta.d.cls]}`}>
        {bigDelta.d.arrow} {bigDelta.d.pctStr}
        <span className="ml-1 font-medium opacity-75">vs {bigDelta.prev}</span>
      </div>
      <div className="mt-3.5 flex flex-col gap-1.5 border-t border-[var(--border)] pt-3 text-[12.5px]">
        {rows.map((r, i) =>
          'head' in r ? (
            <div className="eyebrow mt-1 border-t border-[var(--border)] pt-1.5" key={i}>
              {r.head}
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2.5" key={i}>
              <span className="flex items-center gap-1.5 text-n-700">
                <span className="inline-block size-2 shrink-0 rounded-[2px]" style={{ background: r.swatch }} />
                {r.label}
              </span>
              <span className="min-w-14 text-right font-semibold text-foreground tabular-nums">{r.value}</span>
              <span className={`min-w-14 text-right text-[10.5px] font-bold tabular-nums ${DELTA_INK[r.d.cls]}`}>
                {r.d.arrow} {r.d.pctStr}
              </span>
            </div>
          ),
        )}
      </div>
      {foot && <div className="mt-3.5 text-[11px] text-muted italic">{foot}</div>}
    </div>
  );
}

/**
 * Lo que un neto deja afuera: cobros del Proveedor sin Pago en el Control Panel,
 * por Proveedor y en su moneda de liquidación, o nada si no hubo. Ningún total
 * cruza monedas — "12,3 M ARS (MercadoPago) · 4.500 USD (Stripe)" son dos
 * cifras, no una.
 */
export function OutsidePagosFoot({
  rows,
  prefix = 'Fuera de Pagos',
}: {
  rows: { platformName: string; currency: string; amount: number }[];
  prefix?: string;
}) {
  const shown = rows.filter((r) => Math.round(r.amount) !== 0);
  if (shown.length === 0) return null;
  const parts = shown.map((r) => `${fmtAmount(r.amount)} ${r.currency} (${r.platformName})`);
  return (
    <>
      {prefix}: {parts.join(' · ')}
      <InfoHint text="Cobros que MercadoPago o Stripe registran en la cuenta pero que no tienen un Pago en el Control Panel: otro producto vendido por la misma cuenta, o un Pagos Export todavía no subido. No están en la cifra de arriba; se muestran para que no desaparezcan." />
    </>
  );
}

function fmtAmount(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`;
  return `${sign}${Math.round(a).toLocaleString('es-AR')}`;
}

/**
 * El hueco donde va un gráfico cuya fuente todavía no existe.
 *
 * Quedan dos, desde 2026-09-09: Real vs Plan necesita la planilla de objetivos,
 * y el Asistente necesita un modelo. El ciclo de vida del suscriptor — altas,
 * bajas, activos día a día — ya se calcula sobre los Pagos y sus siete
 * gráficos están dibujados.
 */
export function Pending({
  kind,
  children,
}: {
  kind: 'plan' | 'asistente';
  children?: ReactNode;
}) {
  const label = kind === 'plan' ? 'Real vs Plan · en desarrollo' : 'Asistente · en desarrollo';
  return (
    <div className="flex flex-col items-start gap-2 rounded-[var(--panel-radius)] border border-dashed border-n-300 bg-n-50 p-5.5">
      <span className="tag tag-info uppercase">{label}</span>
      <div className="max-w-[70ch] text-xs leading-relaxed text-n-700">
        {children ?? (
          // Lo que falta para encenderlo — la planilla compartida en modo
          // lectura con la cuenta de servicio, y GOOGLE_SHEETS_ID_TARGETS /
          // GOOGLE_SHEETS_TAB_TARGETS declaradas — está en
          // docs/handoff/financiero-dashboard-port.md, paso 5. Acá no: el
          // nombre de una variable de entorno no le dice nada a quien mira
          // el dashboard.
          <>
            Este gráfico compara contra el <strong>Plan</strong>, que llega de una
            planilla de objetivos todavía no compartida con el dashboard. La planilla
            sólo debe traer el objetivo por Proveedor y mes: el real y el mes anterior
            se calculan acá.
          </>
        )}
      </div>
    </div>
  );
}
