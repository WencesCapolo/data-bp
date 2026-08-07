'use client';
import { useEffect, useRef } from 'react';
import { useFilters, type RangeKind, type TabKey } from './filterStore';
import type { AccessType, SubType, Granularity } from '@basket/core/dtos/shared';

const TABS: TabKey[] = ['overview', 'evolution', 'teams', 'finance', 'retention', 'quality'];
const RANGES: RangeKind[] = ['yesterday', '7d', '30d', '90d', 'ytd', 'all', 'custom'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACCESS: AccessType[] = ['real', 'voucher', 'antel'];
const SUBTYPES: SubType[] = ['Free', 'Mensual_Basico', 'Mensual_Total', 'Anual_Total', 'Otros'];
const GRAN: Granularity[] = ['day', 'week', 'month'];

function pick<T extends string>(v: string | null, allowed: readonly T[]): T | undefined {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function UrlFilterSync() {
  const hydrated = useRef(false);
  const state = useFilters();

  // Hydrate from URL on first mount.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const p = new URLSearchParams(window.location.search);
    const tab = pick(p.get('tab'), TABS);
    const range = pick(p.get('range'), RANGES);
    const accessType = pick(p.get('accessType'), ACCESS);
    const subType = pick(p.get('subType'), SUBTYPES);
    const granularity = pick(p.get('granularity'), GRAN);
    const countries = p.getAll('countries').filter(Boolean);
    const next: Partial<ReturnType<typeof useFilters.getState>> = {};
    if (tab) next.tab = tab;
    if (range) next.range = range;
    const from = p.get('from');
    const to = p.get('to');
    if (from && ISO_DATE.test(from)) next.customFrom = from;
    if (to && ISO_DATE.test(to)) next.customTo = to;
    if (countries.length) next.countries = countries;
    if (accessType) next.accessType = accessType;
    if (subType) next.subType = subType;
    if (granularity) next.granularity = granularity;
    useFilters.setState(next);
  }, []);

  // Write store → URL on every change (after hydration).
  useEffect(() => {
    if (!hydrated.current) return;
    const p = new URLSearchParams();
    p.set('tab', state.tab);
    p.set('range', state.range);
    if (state.range === 'custom') {
      p.set('from', state.customFrom);
      p.set('to', state.customTo);
    }
    for (const c of state.countries) p.append('countries', c);
    if (state.accessType) p.set('accessType', state.accessType);
    if (state.subType) p.set('subType', state.subType);
    if (state.granularity !== 'day') p.set('granularity', state.granularity);
    const qs = p.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (url !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', url);
    }
  }, [
    state.tab,
    state.range,
    state.customFrom,
    state.customTo,
    state.countries,
    state.accessType,
    state.subType,
    state.granularity,
  ]);

  return null;
}
