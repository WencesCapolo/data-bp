'use client';
import type { Granularity } from '@basket/core/dtos/shared';

const OPTS: { val: Granularity; label: string }[] = [
  { val: 'day', label: 'Día' },
  { val: 'week', label: 'Semana' },
  { val: 'month', label: 'Mes' },
];

export function GranularityToggle({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (v: Granularity) => void;
}) {
  return (
    <div className="date-pills">
      {OPTS.map((o) => (
        <button
          key={o.val}
          type="button"
          className={`date-pill ${value === o.val ? 'active' : ''}`}
          onClick={() => onChange(o.val)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
