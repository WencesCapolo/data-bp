'use client';
import { useFilters, type RangeKind } from '@/lib/client/filterStore';
import { PillGroup } from './PillGroup';

const PILLS: { val: RangeKind; label: string }[] = [
  { val: 'yesterday', label: 'Ayer' },
  { val: '7d', label: '7d' },
  { val: '30d', label: '30d' },
  { val: '90d', label: '90d' },
  { val: 'ytd', label: 'YTD' },
  { val: 'all', label: 'Todo' },
  { val: 'custom', label: 'Personalizado' },
];

export function DatePills({ value, onChange }: { value: RangeKind; onChange: (r: RangeKind) => void }) {
  const customFrom = useFilters((s) => s.customFrom);
  const customTo = useFilters((s) => s.customTo);
  const setCustomFrom = useFilters((s) => s.setCustomFrom);
  const setCustomTo = useFilters((s) => s.setCustomTo);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <PillGroup options={PILLS} value={value} onChange={onChange} label="Rango" />
      {value === 'custom' && (
        <span className="inline-flex items-center gap-1">
          <input
            type="date"
            aria-label="Desde"
            className="input py-1 text-xs"
            value={customFrom}
            max={customTo}
            onChange={(e) => setCustomFrom(e.target.value)}
          />
          <span className="text-xs text-muted">→</span>
          <input
            type="date"
            aria-label="Hasta"
            className="input py-1 text-xs"
            value={customTo}
            min={customFrom}
            onChange={(e) => setCustomTo(e.target.value)}
          />
        </span>
      )}
    </div>
  );
}
