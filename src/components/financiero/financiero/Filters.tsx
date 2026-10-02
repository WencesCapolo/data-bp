'use client';
import { useMemo } from 'react';
import useSWR from 'swr';
import { useFilters, type RangeKind } from '@/lib/client/filterStore';
import { fetcher } from '@/lib/client/fetcher';
import type { MetaDTO } from '@basket/core/dtos/MetaDTO';
import type { AccessType, SubType } from '@basket/core/dtos/shared';
import { flagOf, labelOf } from './countries';

/**
 * The prototype's filter block, driving the app's shared filter store.
 *
 * Same three pieces as `public/dashboard.html`: the country tabs with a flag
 * each — the first dozen by Subscribers, the long tail behind a select —, the white card with stacked uppercase labels — plan select, Desde and
 * Hasta as day/month/year triples, a chipset — and the slim quick-filter row
 * underneath. What differs is what they drive: the tabs toggle the store's
 * country list, the plan select is the subscription type, the chipset is the
 * access type, and the triples write a custom range. The quick row keeps the
 * app's relative presets next to the prototype's seasons.
 */

const PLANS: { val: SubType | ''; label: string }[] = [
  { val: '', label: 'Todos los planes' },
  { val: 'Mensual_Basico', label: 'Básico · Mensual' },
  { val: 'Mensual_Total', label: 'Total · Mensual' },
  { val: 'Anual_Total', label: 'Total · Anual' },
  { val: 'Free', label: 'Free' },
  { val: 'Otros', label: 'Otros' },
];

const ACCESS: { val: AccessType | undefined; key: string; label: string }[] = [
  { val: undefined, key: 'all', label: 'Todos' },
  { val: 'real', key: 'real', label: 'Real' },
  { val: 'voucher', key: 'voucher', label: 'Voucher' },
  { val: 'antel', key: 'antel', label: 'Antel' },
];

const PRESETS: { val: RangeKind; label: string }[] = [
  { val: 'yesterday', label: 'Ayer' },
  { val: '7d', label: '7 días' },
  { val: '30d', label: '30 días' },
  { val: '90d', label: '90 días' },
  { val: 'ytd', label: 'Este año' },
];

const TAB_COUNTRIES = 12;
// Los selects de fecha son angostos: el `input` compartido, con menos relleno.
const SELECT = 'input min-w-16 px-2 font-medium normal-case tracking-normal';
// Las etiquetas apiladas sobre cada control.
const FIELD = 'eyebrow flex flex-col gap-1.5';
// El punto de color de cada tipo de acceso, como en el resto del dashboard.
const ACCESS_DOT: Record<string, string> = {
  all: 'bg-n-400',
  real: 'bg-[var(--ok)]',
  voucher: 'bg-amber-500',
  antel: 'bg-blue-600',
};
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DATA_FLOOR = '2020-01-01';

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function seasonOf(day: string): number {
  const y = Number(day.slice(0, 4));
  return Number(day.slice(5, 7)) >= 9 ? y : y - 1;
}
function clamp(iso: string, min: string, max: string): string {
  return iso < min ? min : iso > max ? max : iso;
}

/** The days the store's relative kinds stand for, the way the API reads them. */
function resolveRange(kind: RangeKind, customFrom: string, customTo: string, floor: string): { from: string; to: string } {
  const y = shiftDay(todayIso(), -1);
  switch (kind) {
    case 'custom': return { from: customFrom, to: customTo };
    case 'yesterday': return { from: y, to: y };
    case '7d': return { from: shiftDay(y, -6), to: y };
    case '30d': return { from: shiftDay(y, -29), to: y };
    case '90d': return { from: shiftDay(y, -89), to: y };
    case 'ytd': return { from: `${y.slice(0, 4)}-01-01`, to: y };
    case 'all': return { from: floor, to: y };
  }
}

function DateTriple({
  value,
  years,
  onChange,
  min,
  max,
}: {
  value: string;
  years: number[];
  onChange: (iso: string) => void;
  min: string;
  max: string;
}) {
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  const n = daysInMonth(y, m);
  const set = (ny: number, nm: number, nd: number) => {
    const nn = daysInMonth(ny, nm);
    onChange(clamp(`${ny}-${pad2(nm)}-${pad2(Math.min(nd, nn))}`, min, max));
  };
  // Options outside [min, max] are greyed out rather than snapped back after
  // the fact: a day that has not happened yet, or before the data starts, is
  // not a choice. A month or year is offered while any of its days is.
  const dayOff = (dd: number) => { const iso = `${y}-${pad2(m)}-${pad2(dd)}`; return iso < min || iso > max; };
  const monthOff = (mm: number) =>
    `${y}-${pad2(mm)}-01` > max || `${y}-${pad2(mm)}-${pad2(daysInMonth(y, mm))}` < min;
  const yearOff = (yy: number) => `${yy}-01-01` > max || `${yy}-12-31` < min;
  return (
    <div className="flex gap-1.5">
      <select aria-label="día" className={SELECT} value={pad2(d)} onChange={(e) => set(y, m, Number(e.target.value))}>
        {Array.from({ length: n }, (_, i) => (
          <option key={i} value={pad2(i + 1)} disabled={dayOff(i + 1)}>{pad2(i + 1)}</option>
        ))}
      </select>
      <select aria-label="mes" className={`${SELECT} min-w-[5.5rem]`} value={pad2(m)} onChange={(e) => set(y, Number(e.target.value), d)}>
        {MONTHS_ES.map((name, i) => (
          <option key={name} value={pad2(i + 1)} disabled={monthOff(i + 1)}>{name}</option>
        ))}
      </select>
      <select aria-label="año" className={`${SELECT} min-w-[4.6rem]`} value={String(y)} onChange={(e) => set(Number(e.target.value), m, d)}>
        {years.map((yy) => (
          <option key={yy} value={String(yy)} disabled={yearOff(yy)}>{yy}</option>
        ))}
      </select>
    </div>
  );
}

export function FinancieroFilters() {
  const f = useFilters();
  const { data: meta } = useSWR<MetaDTO>('/api/basket/meta', fetcher);

  const floor = meta?.dataRange.minDay ?? DATA_FLOOR;
  const ceiling = shiftDay(todayIso(), -1);
  const { from, to } = resolveRange(f.range, f.customFrom, f.customTo, floor);

  const years = useMemo(() => {
    const a = Number(floor.slice(0, 4));
    const b = Number(ceiling.slice(0, 4));
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }, [floor, ceiling]);

  const seasons = useMemo(() => {
    const first = seasonOf(floor);
    const last = seasonOf(ceiling);
    return Array.from({ length: last - first + 1 }, (_, i) => {
      const s = first + i;
      return {
        s,
        label: `${String(s).slice(2)}/${String(s + 1).slice(2)}`,
        from: clamp(`${s}-09-01`, floor, ceiling),
        to: clamp(`${s + 1}-08-31`, floor, ceiling),
      };
    });
  }, [floor, ceiling]);

  const setCustom = (nf: string, nt: string) => {
    f.setCustomFrom(nf);
    f.setCustomTo(nt);
    f.setRange('custom');
  };

  // Meta lists countries by Subscribers, most first.
  const allCountries = meta?.countries ?? [];
  const tabCountries = allCountries.slice(0, TAB_COUNTRIES);
  const restCountries = allCountries.slice(TAB_COUNTRIES);
  const restSelected = f.countries.filter((c) => restCountries.includes(c));

  const toggleCountry = (c: string) => {
    f.setCountries(f.countries.includes(c) ? f.countries.filter((x) => x !== c) : [...f.countries, c]);
  };

  return (
    <>
      <div className="card flex items-center gap-1.5 overflow-x-auto p-2.5" role="group" aria-label="País">
        <button
          type="button"
          className="pill text-[13px]"
          aria-pressed={f.countries.length === 0}
          onClick={() => f.setCountries([])}
        >
          <span aria-hidden className="text-base">🌎</span>
          <span>Todos</span>
        </button>
        {tabCountries.map((c) => (
          <button
            key={c}
            type="button"
            className="pill text-[13px]"
            aria-pressed={f.countries.includes(c)}
            onClick={() => toggleCountry(c)}
          >
            <span aria-hidden className="text-base">{flagOf(c)}</span>
            <span>{labelOf(c)}</span>
          </button>
        ))}
        {restCountries.length > 0 && (
          <select
            className={`input ml-auto shrink-0 text-[13px] font-semibold ${restSelected.length > 0 ? 'border-[var(--accent-border)] text-accent-strong' : ''}`}
            aria-label="Más países"
            value=""
            onChange={(e) => { if (e.target.value) toggleCountry(e.target.value); }}
          >
            <option value="">{restSelected.length > 0 ? `+${restSelected.length} más…` : 'Más países…'}</option>
            {restCountries.map((c) => (
              <option key={c} value={c}>
                {f.countries.includes(c) ? '✓ ' : ''}{flagOf(c)} {labelOf(c)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="card flex flex-col gap-4 px-5 py-4">
        <div className="flex flex-wrap items-end gap-5">
          <label className={FIELD}>Tipo de plan
            <select
              className="input min-w-36 font-medium tracking-normal normal-case"
              value={f.subType ?? ''}
              onChange={(e) => f.setSubType((e.target.value || undefined) as SubType | undefined)}
            >
              {PLANS.map((p) => (
                <option key={p.val} value={p.val}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className={FIELD}>Desde
            <DateTriple value={from} years={years} min={floor} max={to} onChange={(v) => setCustom(v, to)} />
          </label>
          <label className={FIELD}>Hasta
            <DateTriple value={to} years={years} min={from} max={ceiling} onChange={(v) => setCustom(from, v)} />
          </label>
          <div className={`${FIELD} min-w-[280px] flex-1`}>Tipo de acceso
            <div className="flex flex-wrap gap-1.5 tracking-normal normal-case" role="group" aria-label="Tipo de acceso">
              {ACCESS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className="pill"
                  aria-pressed={f.accessType === a.val}
                  onClick={() => f.setAccessType(a.val)}
                >
                  <span aria-hidden className={`size-2 rounded-full ${ACCESS_DOT[a.key]}`} />
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-t border-[var(--border)] pt-3.5">
          <span className="eyebrow">Filtro rápido</span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.val}
                type="button"
                className="pill"
                aria-pressed={f.range === p.val}
                onClick={() => f.setRange(p.val)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <span className="eyebrow ml-2.5">Temporada</span>
          <div className="flex flex-wrap gap-1.5">
            {seasons.map((s) => (
              <button
                key={s.s}
                type="button"
                className="pill"
                aria-pressed={f.range === 'custom' && f.customFrom === s.from && f.customTo === s.to}
                onClick={() => setCustom(s.from, s.to)}
              >
                {s.label}
              </button>
            ))}
            <button type="button" className="pill" aria-pressed={f.range === 'all'} onClick={() => f.setRange('all')}>
              Todo el histórico
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
