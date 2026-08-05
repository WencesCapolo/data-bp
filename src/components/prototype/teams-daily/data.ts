'use client';
// PROTOTYPE — shared types + fetch hook for the teams-daily variants.
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { useFilters } from '@/lib/client/filterStore';

export interface TeamDailyRow {
  teamId: number;
  teamName: string;
  league: string;
  country: string;
  followers: number;
  newFollowers: number;
  activeNow: number;
  altas: number;
  bajas: number;
  net: number;
  altasByDay: number[];
  bajasByDay: number[];
  activeByDay: number[];
}

export interface TeamsDailyDTO {
  from: string;
  to: string;
  days: string[];
  totals: {
    followers: number;
    activeNow: number;
    altas: number;
    bajas: number;
    net: number;
    teamsWithMovement: number;
  };
  daily: { day: string; altas: number; bajas: number; net: number; active: number }[];
  teams: TeamDailyRow[];
}

export function useTeamsDaily() {
  const range = useFilters((s) => s.range);
  const countries = useFilters((s) => s.countries);
  const accessType = useFilters((s) => s.accessType);
  const subType = useFilters((s) => s.subType);

  const p = new URLSearchParams();
  p.set('range', range);
  for (const c of countries) p.append('countries', c);
  if (accessType) p.set('accessType', accessType);
  if (subType) p.set('subType', subType);

  return useSWR<TeamsDailyDTO>(`/api/basket/teams-daily-prototype?${p.toString()}`, fetcher, {
    keepPreviousData: true,
  });
}

export const fmtDay = (d: string): string => d.slice(5).replace('-', '/');

export type Bucket = 'day' | 'week' | 'month' | 'year';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function bucketKey(iso: string, b: Bucket): string {
  if (b === 'day') return iso;
  if (b === 'year') return iso.slice(0, 4);
  if (b === 'month') return iso.slice(0, 7);
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function bucketLabel(key: string, b: Bucket): string {
  if (b === 'year') return key;
  if (b === 'month') return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
  if (b === 'week') return `sem ${fmtDay(key)}`;
  return fmtDay(key);
}

// Altas/bajas are flows — they add up inside a bucket. Active subscriptions are a
// stock, so a bucket takes its last day's value, not a sum.
export function bucketize(
  days: string[],
  series: { altas: number[]; bajas: number[]; active: number[] },
  b: Bucket,
): { keys: string[]; labels: string[]; altas: number[]; bajas: number[]; active: number[] } {
  const keys: string[] = [];
  const altas: number[] = [];
  const bajas: number[] = [];
  const active: number[] = [];
  days.forEach((iso, i) => {
    const key = bucketKey(iso, b);
    if (keys[keys.length - 1] !== key) {
      keys.push(key);
      altas.push(0);
      bajas.push(0);
      active.push(0);
    }
    const j = keys.length - 1;
    altas[j] += series.altas[i] ?? 0;
    bajas[j] += series.bajas[i] ?? 0;
    active[j] = series.active[i] ?? 0;
  });
  return { keys, labels: keys.map((k) => bucketLabel(k, b)), altas, bajas, active };
}
export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));
export const netColor = (n: number): string =>
  n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text3)';
