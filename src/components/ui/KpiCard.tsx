import type { ReactNode } from 'react';
import { InfoHint } from './InfoHint';

interface Props {
  label: string;
  value: number | string;
  sub?: string;
  delta?: { value: string; up: boolean };
  variant?: 'default' | 'blue' | 'green' | 'yellow' | 'red';
  /** Una frase que explica qué mide el número. Se muestra al pasar por el "?". */
  hint?: ReactNode;
}

export function KpiCard({ label, value, sub, delta, variant = 'default', hint }: Props) {
  const display = typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <div className={`kpi-card ${variant === 'default' ? '' : variant}`}>
      <div className="kpi-label">
        {label}
        {hint && <InfoHint text={hint} />}
      </div>
      <div className="kpi-value">{display}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {delta && (
        <div className={`kpi-delta ${delta.up ? 'up' : 'down'}`}>
          {delta.up ? '▲' : '▼'} {delta.value}
        </div>
      )}
    </div>
  );
}
