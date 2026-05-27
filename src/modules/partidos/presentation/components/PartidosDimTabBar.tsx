'use client';
import { usePartidosFilters, type PartidosDim } from '../state/partidosFilterStore';

const TABS: { key: PartidosDim; label: string }[] = [
  { key: 'nacional', label: 'Nacional' },
  { key: 'intl', label: 'Internacional' },
];

export function PartidosDimTabBar() {
  const dim = usePartidosFilters((s) => s.dim);
  const setDim = usePartidosFilters((s) => s.setDim);
  return (
    <div className="tabs" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={dim === t.key}
          className={`tab ${dim === t.key ? 'active' : ''}`}
          onClick={() => setDim(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
