'use client';
import { create } from 'zustand';

export type RangeKind = '30d' | '90d' | 'ytd' | 'all';
export type TabKey = 'overview' | 'evolution' | 'teams' | 'finance' | 'retention' | 'quality';

interface FilterState {
  tab: TabKey;
  range: RangeKind;
  setTab: (t: TabKey) => void;
  setRange: (r: RangeKind) => void;
}

export const useFilters = create<FilterState>((set) => ({
  tab: 'overview',
  range: '30d',
  setTab: (t) => set({ tab: t }),
  setRange: (r) => set({ range: r }),
}));
