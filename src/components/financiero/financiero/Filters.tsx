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
    <div className="proto-date-triple">
      <select aria-label="día" value={pad2(d)} onChange={(e) => set(y, m, Number(e.target.value))}>
        {Array.from({ length: n }, (_, i) => (
          <option key={i} value={pad2(i + 1)} disabled={dayOff(i + 1)}>{pad2(i + 1)}</option>
        ))}
      </select>
      <select aria-label="mes" value={pad2(m)} onChange={(e) => set(y, Number(e.target.value), d)}>
        {MONTHS_ES.map((name, i) => (
          <option key={name} value={pad2(i + 1)} disabled={monthOff(i + 1)}>{name}</option>
        ))}
      </select>
      <select aria-label="año" value={String(y)} onChange={(e) => set(Number(e.target.value), m, d)}>
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
      <div className="proto-tabs" role="group" aria-label="País">
        <button
          type="button"
          className={f.countries.length === 0 ? 'active' : ''}
          onClick={() => f.setCountries([])}
        >
          <span className="flag">🌎</span><span>Todos</span>
        </button>
        {tabCountries.map((c) => (
          <button
            key={c}
            type="button"
            className={f.countries.includes(c) ? 'active' : ''}
            aria-pressed={f.countries.includes(c)}
            onClick={() => toggleCountry(c)}
          >
            <span className="flag">{flagOf(c)}</span><span>{labelOf(c)}</span>
          </button>
        ))}
        {restCountries.length > 0 && (
          <select
            className="proto-tabs-more"
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

      <div className="proto-filters">
        <label>Tipo de plan
          <select
            value={f.subType ?? ''}
            onChange={(e) => f.setSubType((e.target.value || undefined) as SubType | undefined)}
          >
            {PLANS.map((p) => (
              <option key={p.val} value={p.val}>{p.label}</option>
            ))}
          </select>
        </label>
        <label>Desde
          <DateTriple value={from} years={years} min={floor} max={to} onChange={(v) => setCustom(v, to)} />
        </label>
        <label>Hasta
          <DateTriple value={to} years={years} min={from} max={ceiling} onChange={(v) => setCustom(from, v)} />
        </label>
        <label style={{ flex: 1, minWidth: 280 }}>Tipo de acceso
          <div className="proto-chipset">
            {ACCESS.map((a) => (
              <span
                key={a.key}
                role="button"
                tabIndex={0}
                data-access={a.key}
                className={`proto-chip ${f.accessType === a.val ? 'active' : ''}`}
                onClick={() => f.setAccessType(a.val)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.setAccessType(a.val); } }}
              >
                <span className="dot" />{a.label}
              </span>
            ))}
          </div>
        </label>
      </div>

      <div className="proto-filters proto-filters-quick">
        <span className="proto-filters-quick-label">Filtro rápido</span>
        <div className="proto-chipset">
          {PRESETS.map((p) => (
            <span
              key={p.val}
              role="button"
              tabIndex={0}
              className={`proto-chip ${f.range === p.val ? 'active' : ''}`}
              onClick={() => f.setRange(p.val)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.setRange(p.val); } }}
            >
              {p.label}
            </span>
          ))}
        </div>
        <span className="proto-filters-quick-label">Temporada</span>
        <div className="proto-chipset">
          {seasons.map((s) => {
            const active = f.range === 'custom' && f.customFrom === s.from && f.customTo === s.to;
            return (
              <span
                key={s.s}
                role="button"
                tabIndex={0}
                className={`proto-chip ${active ? 'active' : ''}`}
                onClick={() => setCustom(s.from, s.to)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCustom(s.from, s.to); } }}
              >
                {s.label}
              </span>
            );
          })}
          <span
            role="button"
            tabIndex={0}
            className={`proto-chip ${f.range === 'all' ? 'active' : ''}`}
            onClick={() => f.setRange('all')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.setRange('all'); } }}
          >
            Todo el histórico
          </span>
        </div>
      </div>
    </>
  );
}
