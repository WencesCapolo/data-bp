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
    <div className="proto-card">
      <h2>
        {title}
        {hint && <InfoHint text={hint} />}
        {note && <span className="proto-note">{note}</span>}
      </h2>
      {desc && <div className="desc">{desc}</div>}
      {children}
      {foot && <div className="proto-foot">{foot}</div>}
    </div>
  );
}

/** La etiqueta que separa bloques de KPIs. `first` quita el margen de arriba. */
export function SectionLabel({ children, first }: { children: ReactNode; first?: boolean }) {
  return <div className={`proto-section-label${first ? ' first' : ''}`}>{children}</div>;
}

export type KpiTone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate';

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
    <div className={`proto-kpi ${tone}`}>
      <div className="icon">{icon}</div>
      <h3>
        {title}
        {hint && <InfoHint text={hint} />}
      </h3>
      <div className="v">{value}</div>
      <div className="s">{children}</div>
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
    <div className="kpi-breakdown">
      {rows.map((r, i) =>
        'head' in r ? (
          <div className="row sep head" key={i}>
            {r.head}
          </div>
        ) : (
          <div className={`row${r.sep ? ' sep' : ''}`} key={i}>
            <span className="label">
              <span className="swatch" style={{ background: r.swatch }} />
              {r.label}
            </span>
            <span>
              <span className="num" style={{ color: r.color ?? 'inherit' }}>
                {r.value}
              </span>
              {r.pct !== undefined && <span className="pct">{r.pct}</span>}
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

/** Una de las tres columnas del snapshot. */
export function MsCol({
  tone,
  title,
  hint,
  big,
  bigDelta,
  rows,
}: {
  tone: 'tx' | 'active' | 'revenue';
  title: string;
  hint?: ReactNode;
  big: string;
  bigDelta: { d: Delta; prev: string };
  rows: ({ swatch: string; label: string; value: string; d: Delta } | { head: string })[];
}) {
  return (
    <div className={`proto-ms-col ${tone}`}>
      <h4>
        {title}
        {hint && <InfoHint text={hint} />}
      </h4>
      <div className="proto-ms-big">{big}</div>
      <div className={`proto-ms-delta ${bigDelta.d.cls}`}>
        {bigDelta.d.arrow} {bigDelta.d.pctStr}
        <span className="prev">vs {bigDelta.prev}</span>
      </div>
      <div className="proto-ms-items">
        {rows.map((r, i) =>
          'head' in r ? (
            <div className="row head" key={i}>
              {r.head}
            </div>
          ) : (
            <div className="row" key={i}>
              <span className="label">
                <span className="swatch" style={{ background: r.swatch }} />
                {r.label}
              </span>
              <span className="num">{r.value}</span>
              <span className={`d ${r.d.cls}`}>
                {r.d.arrow} {r.d.pctStr}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
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
    <div className="proto-pending">
      <span className="proto-pending-badge dev">{label}</span>
      <div className="proto-pending-body">
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
