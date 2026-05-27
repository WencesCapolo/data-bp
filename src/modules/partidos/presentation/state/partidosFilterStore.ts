'use client';
import { create } from 'zustand';
import type {
  PartidosNacionalFilters,
  PartidosIntlFilters,
} from '@partidos/core/dtos/shared';

export type PartidosDim = 'nacional' | 'intl';

interface State {
  dim: PartidosDim;
  nacional: PartidosNacionalFilters;
  intl: PartidosIntlFilters;
  setDim: (d: PartidosDim) => void;
  setNacional: (f: Partial<PartidosNacionalFilters>) => void;
  setIntl: (f: Partial<PartidosIntlFilters>) => void;
  resetNacional: () => void;
  resetIntl: () => void;
}

const EMPTY_NACIONAL: PartidosNacionalFilters = {
  seasons: [],
  leagues: [],
  controls: [],
  monthFrom: null,
  monthTo: null,
  weeks: [],
};

const EMPTY_INTL: PartidosIntlFilters = {
  seasons: [],
  countries: [],
  leagues: [],
  monthFrom: null,
  monthTo: null,
  weeks: [],
};

export const usePartidosFilters = create<State>((set) => ({
  dim: 'nacional',
  nacional: EMPTY_NACIONAL,
  intl: EMPTY_INTL,
  setDim: (d) => set({ dim: d }),
  setNacional: (f) =>
    set((s) => ({ nacional: { ...s.nacional, ...f } })),
  setIntl: (f) => set((s) => ({ intl: { ...s.intl, ...f } })),
  resetNacional: () => set({ nacional: EMPTY_NACIONAL }),
  resetIntl: () => set({ intl: EMPTY_INTL }),
}));

export function buildNacionalQS(f: PartidosNacionalFilters): string {
  const p = new URLSearchParams();
  for (const s of f.seasons ?? []) p.append('seasons', s);
  for (const l of f.leagues ?? []) p.append('leagues', l);
  for (const c of f.controls ?? []) p.append('controls', c);
  for (const w of f.weeks ?? []) p.append('weeks', w);
  if (f.monthFrom) p.set('monthFrom', f.monthFrom);
  if (f.monthTo) p.set('monthTo', f.monthTo);
  return p.toString();
}

export function buildIntlQS(f: PartidosIntlFilters): string {
  const p = new URLSearchParams();
  for (const s of f.seasons ?? []) p.append('seasons', s);
  for (const c of f.countries ?? []) p.append('countries', c);
  for (const l of f.leagues ?? []) p.append('leagues', l);
  for (const w of f.weeks ?? []) p.append('weeks', w);
  if (f.monthFrom) p.set('monthFrom', f.monthFrom);
  if (f.monthTo) p.set('monthTo', f.monthTo);
  return p.toString();
}
