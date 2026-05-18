'use client';
import type { RangeKind } from '@/lib/client/filterStore';

const PILLS: { val: RangeKind; label: string }[] = [
  { val: '30d', label: '30d' },
  { val: '90d', label: '90d' },
  { val: 'ytd', label: 'YTD' },
  { val: 'all', label: 'Todo' },
];

export function DatePills({ value, onChange }: { value: RangeKind; onChange: (r: RangeKind) => void }) {
  return (
    <div className="date-pills">
      {PILLS.map((p) => (
        <button
          key={p.val}
          className={`date-pill ${value === p.val ? 'active' : ''}`}
          onClick={() => onChange(p.val)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
