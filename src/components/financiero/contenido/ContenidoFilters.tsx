'use client';
import { seasonRange } from './format';

/**
 * Contenido's own filter bar, and deliberately not the shared `FilterRow`.
 *
 * Two reasons. The country here is the content's — where a match was played —
 * while the shared filter's country is the Subscriber's; wiring one into the
 * other would answer an audience question with a billing filter and still return
 * a number. And the range here is a plain pair of days over the whole catalogue,
 * not the shared store's "last 30 days" relative kinds, because the interesting
 * spans are seasons.
 */
export interface ContenidoFilterState {
  from: string;
  to: string;
  country: string;
}

const SEASONS = [2021, 2022, 2023, 2024, 2025];

/** A typed date is clamped into [min, max]: the picker's own bounds only
 *  govern the calendar popup, not the keyboard. An empty value (mid-edit)
 *  stays as is. */
function clampDay(iso: string, min: string, max: string): string {
  if (!iso) return iso;
  return iso < min ? min : iso > max ? max : iso;
}

export function ContenidoFilters({
  value,
  onChange,
  countries,
  floor,
  ceiling,
}: {
  value: ContenidoFilterState;
  onChange: (next: ContenidoFilterState) => void;
  countries: string[];
  floor: string;
  ceiling: string;
}) {
  const activeSeason = SEASONS.find((y) => {
    const r = seasonRange(y);
    return value.from === r.from && value.to === r.to;
  });
  const isAll = value.from === floor && value.to === ceiling;

  return (
    <div className="card flex flex-wrap items-center gap-3.5 p-3.5">
      <span className="inline-flex items-center gap-1.5">
        <span className="eyebrow">Desde</span>
        <input
          type="date"
          className="input py-1 text-xs"
          value={value.from}
          min={floor}
          max={value.to}
          onChange={(e) => onChange({ ...value, from: clampDay(e.target.value, floor, value.to) })}
        />
        <span className="text-[11px] text-muted">→</span>
        <span className="eyebrow">Hasta</span>
        <input
          type="date"
          className="input py-1 text-xs"
          value={value.to}
          min={value.from}
          max={ceiling}
          onChange={(e) => onChange({ ...value, to: clampDay(e.target.value, value.from, ceiling) })}
        />
      </span>

      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="eyebrow">Temporada</span>
        <span className="flex flex-wrap gap-1.5">
          {SEASONS.map((y) => {
            const r = seasonRange(y);
            return (
              <button
                key={y}
                type="button"
                className="pill"
                aria-pressed={activeSeason === y}
                onClick={() => onChange({ ...value, from: r.from, to: r.to })}
              >
                {r.label}
              </button>
            );
          })}
          <button
            type="button"
            className="pill"
            aria-pressed={isAll}
            onClick={() => onChange({ ...value, from: floor, to: ceiling })}
          >
            Todo el histórico
          </button>
        </span>
      </span>

      <span className="ml-auto inline-flex items-center gap-2">
        {/* País del contenido, no del Subscriber: dónde se jugó el partido. */}
        <span className="eyebrow">País del contenido</span>
        <select
          className="input text-xs"
          value={value.country}
          onChange={(e) => onChange({ ...value, country: e.target.value })}
        >
          <option value="">Todos los países</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
