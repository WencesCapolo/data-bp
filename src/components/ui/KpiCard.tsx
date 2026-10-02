import type { ReactNode } from 'react';
import { InfoHint } from './InfoHint';

type Variant = 'default' | 'blue' | 'green' | 'yellow' | 'red';

interface Props {
  label: string;
  value: number | string;
  sub?: string;
  delta?: { value: string; up: boolean };
  variant?: Variant;
  /** Una frase que explica qué mide el número. Se muestra al pasar por el "?". */
  hint?: ReactNode;
}

// The 3px bar on top tells the families of KPIs apart.
const BAR: Record<Variant, string> = {
  default: 'before:bg-accent',
  blue: 'before:bg-sky-600',
  green: 'before:bg-[var(--ok)]',
  yellow: 'before:bg-amber-500',
  red: 'before:bg-red-600',
};

export function KpiCard({ label, value, sub, delta, variant = 'default', hint }: Props) {
  const display = typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <div
      className={`card relative overflow-hidden p-5 before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:content-[''] ${BAR[variant]}`}
    >
      <div className="eyebrow mb-2 flex items-center">
        {label}
        {hint && <InfoHint text={hint} />}
      </div>
      <div className="figure text-[2rem] max-sm:text-[1.75rem]">{display}</div>
      {sub && <div className="mt-1.5 font-mono text-[11px] text-muted">{sub}</div>}
      {delta && (
        <div className={`mt-1.5 font-mono text-[11px] ${delta.up ? 'text-[var(--ok)]' : 'text-red-700'}`}>
          {delta.up ? '▲' : '▼'} {delta.value}
        </div>
      )}
    </div>
  );
}

/** The KPI row. */
export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">{children}</div>;
}
