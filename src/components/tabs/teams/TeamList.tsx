'use client';
import type { TeamRankRow } from '@basket/core/dtos/TeamsDTO';
import { netClass, signed } from './format';

export type TeamSort = 'followers' | 'altas' | 'bajas';

// Ties fall back to followers so the order stays stable between sorts.
export const TEAM_SORTS: Record<TeamSort, (a: TeamRankRow, b: TeamRankRow) => number> = {
  followers: (a, b) => b.followers - a.followers,
  altas: (a, b) => b.altas - a.altas || b.followers - a.followers,
  bajas: (a, b) => b.bajas - a.bajas || b.followers - a.followers,
};

const SORT_LABELS: Array<{ key: TeamSort; label: string }> = [
  { key: 'altas', label: 'Altas' },
  { key: 'bajas', label: 'Bajas' },
  { key: 'followers', label: 'Seguidores' },
];

interface Props {
  teams: TeamRankRow[];
  selectedId?: number;
  onSelect: (teamId: number) => void;
  query: string;
  onQueryChange: (q: string) => void;
  sort: TeamSort;
  onSortChange: (s: TeamSort) => void;
}

export function TeamList({
  teams,
  selectedId,
  onSelect,
  query,
  onQueryChange,
  sort,
  onSortChange,
}: Props) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-[var(--border)] p-3">
        <input
          className="input w-full"
          placeholder="Buscar equipo…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <div className="mt-2 flex gap-1" role="group" aria-label="Ordenar por">
          {SORT_LABELS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={key === sort}
              onClick={() => onSortChange(key)}
              className="pill flex-1 justify-center py-1 text-[11px]"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[68vh] overflow-y-auto max-lg:max-h-80">
        {teams.length === 0 && <div className="p-10 text-center text-sm text-muted">Sin equipos</div>}
        {teams.map((t) => {
          const selected = t.teamId === selectedId;
          return (
            <button
              key={t.teamId}
              type="button"
              aria-current={selected || undefined}
              onClick={() => onSelect(t.teamId)}
              className={`grid w-full grid-cols-[1fr_auto] gap-2 border-b border-l-[3px] border-b-[var(--border)] px-3 py-2.5 text-left text-foreground transition-colors ${
                selected ? 'border-l-accent bg-accent-soft' : 'border-l-transparent hover:bg-n-50'
              }`}
            >
              <span className="text-[13px] font-semibold">{t.teamName}</span>
              <span className="text-right font-mono">
                <span className="block text-xs">
                  <span className="mr-1 text-[9px] text-muted">subs</span>
                  {t.activeSubs.toLocaleString()}
                  <span className={`ml-1 text-[11px] ${netClass(t.net)}`}>{signed(t.net)}</span>
                </span>
                <span className="block text-[11px] text-muted">
                  <span className="mr-1 text-[9px]">seg</span>
                  {t.followers.toLocaleString()}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
