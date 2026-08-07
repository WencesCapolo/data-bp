'use client';
import { useFilters, type RangeKind } from '@/lib/client/filterStore';

const PILLS: { val: RangeKind; label: string }[] = [
  { val: 'yesterday', label: 'Ayer' },
  { val: '7d', label: '7d' },
  { val: '30d', label: '30d' },
  { val: '90d', label: '90d' },
  { val: 'ytd', label: 'YTD' },
  { val: 'all', label: 'Todo' },
  { val: 'custom', label: 'Personalizado' },
];

const dateInputStyle: React.CSSProperties = {
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  color: 'var(--text2)',
  borderRadius: 6,
  fontSize: 11,
  padding: '5px 8px',
  colorScheme: 'dark',
};

export function DatePills({ value, onChange }: { value: RangeKind; onChange: (r: RangeKind) => void }) {
  const customFrom = useFilters((s) => s.customFrom);
  const customTo = useFilters((s) => s.customTo);
  const setCustomFrom = useFilters((s) => s.setCustomFrom);
  const setCustomTo = useFilters((s) => s.setCustomTo);

  return (
    <div className="date-pills" style={{ alignItems: 'center' }}>
      {PILLS.map((p) => (
        <button
          key={p.val}
          className={`date-pill ${value === p.val ? 'active' : ''}`}
          onClick={() => onChange(p.val)}
        >
          {p.label}
        </button>
      ))}
      {value === 'custom' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input
            type="date"
            style={dateInputStyle}
            value={customFrom}
            max={customTo}
            onChange={(e) => setCustomFrom(e.target.value)}
          />
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>→</span>
          <input
            type="date"
            style={dateInputStyle}
            value={customTo}
            min={customFrom}
            onChange={(e) => setCustomTo(e.target.value)}
          />
        </span>
      )}
    </div>
  );
}
