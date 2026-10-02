'use client';
import { useFilters, type TabKey } from '@/lib/client/filterStore';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Visión General' },
  { key: 'evolution', label: 'Evolución Histórica' },
  { key: 'teams', label: 'Análisis por Equipo' },
  { key: 'retention', label: 'Retención / Churn' },
  { key: 'quality', label: 'Calidad de Datos' },
];

export function TabBar() {
  const tab = useFilters((s) => s.tab);
  const setTab = useFilters((s) => s.setTab);
  return <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} label="Vista" />;
}
