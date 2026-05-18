'use client';
import { create } from 'zustand';
import type { AccessType, SubType, Granularity } from '@basket/core/dtos/shared';

export type RangeKind = '30d' | '90d' | 'ytd' | 'all';
export type TabKey = 'overview' | 'evolution' | 'teams' | 'finance' | 'retention' | 'quality';

interface FilterState {
  tab: TabKey;
  range: RangeKind;
  countries: string[];
  accessType?: AccessType;
  subType?: SubType;
  granularity: Granularity;
  setTab: (t: TabKey) => void;
  setRange: (r: RangeKind) => void;
  setCountries: (c: string[]) => void;
  setAccessType: (a?: AccessType) => void;
  setSubType: (s?: SubType) => void;
  setGranularity: (g: Granularity) => void;
  resetFilters: () => void;
}

export const useFilters = create<FilterState>((set) => ({
  tab: 'overview',
  range: '30d',
  countries: [],
  accessType: undefined,
  subType: undefined,
  granularity: 'day',
  setTab: (t) => set({ tab: t }),
  setRange: (r) => set({ range: r }),
  setCountries: (c) => set({ countries: c }),
  setAccessType: (a) => set({ accessType: a }),
  setSubType: (s) => set({ subType: s }),
  setGranularity: (g) => set({ granularity: g }),
  resetFilters: () => set({ countries: [], accessType: undefined, subType: undefined }),
}));

export function buildFilterQS(s: {
  range: RangeKind;
  countries: string[];
  accessType?: AccessType;
  subType?: SubType;
  granularity?: Granularity;
}): string {
  const p = new URLSearchParams();
  p.set('range', s.range);
  for (const c of s.countries) p.append('countries', c);
  if (s.accessType) p.set('accessType', s.accessType);
  if (s.subType) p.set('subType', s.subType);
  if (s.granularity) p.set('granularity', s.granularity);
  return p.toString();
}
