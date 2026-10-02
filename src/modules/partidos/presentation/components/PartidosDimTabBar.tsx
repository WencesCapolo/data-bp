'use client';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { usePartidosFilters, type PartidosDim } from '../state/partidosFilterStore';

const TABS: { key: PartidosDim; label: string }[] = [
  { key: 'nacional', label: 'Nacional' },
  { key: 'intl', label: 'Internacional' },
];

export function PartidosDimTabBar() {
  const dim = usePartidosFilters((s) => s.dim);
  const setDim = usePartidosFilters((s) => s.setDim);
  return <SegmentedTabs tabs={TABS} value={dim} onChange={setDim} label="Alcance" />;
}
