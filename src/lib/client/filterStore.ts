'use client';
import { create } from 'zustand';
import type { AccessType, SubType, Granularity } from '@basket/core/dtos/shared';

export type RangeKind = 'yesterday' | '7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom';

export type TabKey = 'overview' | 'evolution' | 'teams' | 'finance' | 'retention' | 'quality';

// Analytics never counts today, so the custom picker defaults to the last 30
// closed days — same reference day the API uses.
function shiftedDay(deltaDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

interface FilterState {
  tab: TabKey;
  range: RangeKind;
  customFrom: string;
  customTo: string;
  countries: string[];
  accessType?: AccessType;
  subType?: SubType;
  granularity: Granularity;
  setTab: (t: TabKey) => void;
  setRange: (r: RangeKind) => void;
  setCustomFrom: (d: string) => void;
  setCustomTo: (d: string) => void;
  setCountries: (c: string[]) => void;
  setAccessType: (a?: AccessType) => void;
  setSubType: (s?: SubType) => void;
  setGranularity: (g: Granularity) => void;
  resetFilters: () => void;
}

export const useFilters = create<FilterState>((set) => ({
  tab: 'overview',
  range: '30d',
  customFrom: shiftedDay(-30),
  customTo: shiftedDay(-1),
  countries: [],
  accessType: undefined,
  subType: undefined,
  granularity: 'day',
  setTab: (t) => set({ tab: t }),
  setRange: (r) => set({ range: r }),
  setCustomFrom: (d) => set({ customFrom: d }),
  setCustomTo: (d) => set({ customTo: d }),
  setCountries: (c) => set({ countries: c }),
  setAccessType: (a) => set({ accessType: a }),
  setSubType: (s) => set({ subType: s }),
  setGranularity: (g) => set({ granularity: g }),
  resetFilters: () => set({ countries: [], accessType: undefined, subType: undefined }),
}));

export interface FilterQSInput {
  range: RangeKind;
  customFrom?: string;
  customTo?: string;
  countries: string[];
  accessType?: AccessType;
  subType?: SubType;
  granularity?: Granularity;
}

export function buildFilterQS(s: FilterQSInput): string {
  const p = new URLSearchParams();
  p.set('range', s.range);
  // The API rejects range=custom without both bounds.
  if (s.range === 'custom' && s.customFrom && s.customTo) {
    p.set('from', s.customFrom);
    p.set('to', s.customTo);
  }
  for (const c of s.countries) p.append('countries', c);
  if (s.accessType) p.set('accessType', s.accessType);
  if (s.subType) p.set('subType', s.subType);
  if (s.granularity) p.set('granularity', s.granularity);
  return p.toString();
}

// Every tab reads the same slice of the store for its request URL.
export function useFilterQS(extra?: { granularity?: boolean }): string {
  const range = useFilters((s) => s.range);
  const customFrom = useFilters((s) => s.customFrom);
  const customTo = useFilters((s) => s.customTo);
  const countries = useFilters((s) => s.countries);
  const accessType = useFilters((s) => s.accessType);
  const subType = useFilters((s) => s.subType);
  const granularity = useFilters((s) => s.granularity);
  return buildFilterQS({
    range,
    customFrom,
    customTo,
    countries,
    accessType,
    subType,
    granularity: extra?.granularity ? granularity : undefined,
  });
}
