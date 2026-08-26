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

const dateInput: React.CSSProperties = {
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  color: 'var(--text2)',
  borderRadius: 6,
  fontSize: 12,
  padding: '6px 9px',
  colorScheme: 'dark',
};
const legend: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight: 600,
};

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
    <div className="filter-row" style={{ gap: 14 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={legend}>Desde</span>
        <input
          type="date"
          style={dateInput}
          value={value.from}
          max={value.to}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>→</span>
        <span style={legend}>Hasta</span>
        <input
          type="date"
          style={dateInput}
          value={value.to}
          min={value.from}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
        />
      </span>

      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={legend}>Temporada</span>
        <span className="date-pills">
          {SEASONS.map((y) => {
            const r = seasonRange(y);
            return (
              <button
                key={y}
                className={`date-pill ${activeSeason === y ? 'active' : ''}`}
                onClick={() => onChange({ ...value, from: r.from, to: r.to })}
              >
                {r.label}
              </button>
            );
          })}
          <button
            className={`date-pill ${isAll ? 'active' : ''}`}
            onClick={() => onChange({ ...value, from: floor, to: ceiling })}
          >
            Todo el histórico
          </button>
        </span>
      </span>

      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
        {/* País del contenido, no del Subscriber: dónde se jugó el partido. */}
        <span style={legend}>País del contenido</span>
        <select
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
