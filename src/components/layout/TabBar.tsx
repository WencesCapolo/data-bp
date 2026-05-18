'use client';
import { useFilters, type TabKey } from '@/lib/client/filterStore';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Visión General' },
  { key: 'evolution', label: 'Evolución Histórica' },
  { key: 'teams', label: 'Análisis por Equipo' },
  { key: 'finance', label: 'Análisis Financiero' },
  { key: 'retention', label: 'Retención / Churn' },
  { key: 'quality', label: 'Calidad de Datos' },
];

export function TabBar() {
  const tab = useFilters((s) => s.tab);
  const setTab = useFilters((s) => s.setTab);
  return (
    <div className="tabs" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={tab === t.key}
          className={`tab ${tab === t.key ? 'active' : ''}`}
          onClick={() => setTab(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
