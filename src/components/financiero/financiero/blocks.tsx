'use client';
import type { ReactNode } from 'react';
import { InfoHint } from '@/components/ui/InfoHint';

/**
 * Una tarjeta del prototipo: título, descripción larga arriba (no abajo) y el
 * contenido debajo. El prototipo explica cada gráfico *antes* de mostrarlo, y
 * ese orden es parte de lo que se está portando: la descripción dice qué mide
 * el eje, y leerla después de mirar el gráfico llega tarde.
 */
export function Card({
  title,
  note,
  hint,
  desc,
  foot,
  children,
}: {
  title: string;
  /** Aclaración corta al lado del título, como el país activo. */
  note?: ReactNode;
  /** Una frase que explica qué mide el gráfico. Se muestra al pasar por el "?". */
  hint?: ReactNode;
  desc?: ReactNode;
  foot?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="proto-card">
      <div className="proto-card-title">
        {title}
        {hint && <InfoHint text={hint} />}
        {note && <span className="proto-note">{note}</span>}
      </div>
      {desc && <div className="proto-desc">{desc}</div>}
      {children}
      {foot && <div className="proto-foot">{foot}</div>}
    </div>
  );
}

/**
 * El hueco donde va un gráfico cuya fuente todavía no existe.
 *
 * Dos estados, y no uno, porque son dos frases distintas y no se responden
 * igual: `pendiente` es un dato que nadie puede producir todavía —
 * Suscripciones espera el Export de *planes de suscripción* de MercadoPago —
 * y `en desarrollo` es un dato que existe y una pantalla a medio construir:
 * Real vs Plan sólo necesita la planilla de objetivos.
 */
export function Pending({
  kind,
  children,
}: {
  kind: 'suscripciones' | 'plan' | 'asistente';
  children?: ReactNode;
}) {
  const label =
    kind === 'suscripciones'
      ? 'Suscripciones · pendiente'
      : kind === 'plan'
        ? 'Real vs Plan · en desarrollo'
        : 'Asistente · en desarrollo';
  return (
    <div className="proto-pending">
      <span className={`proto-pending-badge ${kind === 'suscripciones' ? '' : 'dev'}`}>{label}</span>
      <div className="proto-pending-body">
        {children ??
          (kind === 'suscripciones' ? (
            <>
              Este gráfico se alimenta de <strong>Suscripciones</strong>, que todavía no
              tiene tabla: las de MercadoPago viven en el Export de{' '}
              <em>planes de suscripción</em>, que nadie generó aún. No es un problema de
              pantalla — el número no existe en la base.
            </>
          ) : (
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
          ))}
      </div>
    </div>
  );
}

/** La etiqueta que separa bloques de KPIs, como en el prototipo. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="proto-section-label">{children}</div>;
}
