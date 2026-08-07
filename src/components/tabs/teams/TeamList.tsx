'use client';
import type { TeamRankRow } from '@basket/core/dtos/TeamsDTO';
import { netColor, signed } from './format';

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
    <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
        <input
          className="search-input"
          style={{ width: '100%' }}
          placeholder="Buscar equipo…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          {SORT_LABELS.map(({ key, label }) => {
            const active = key === sort;
            return (
              <button
                key={key}
                onClick={() => onSortChange(key)}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  fontSize: 10,
                  borderRadius: 4,
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'var(--bg3)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text3)',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ maxHeight: '68vh', overflowY: 'auto' }}>
        {teams.length === 0 && <div className="no-data">Sin equipos</div>}
        {teams.map((t) => {
          const selected = t.teamId === selectedId;
          return (
            <button
              key={t.teamId}
              onClick={() => onSelect(t.teamId)}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 8,
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                borderLeft: `3px solid ${selected ? 'var(--accent)' : 'transparent'}`,
                background: selected ? 'var(--bg3)' : 'transparent',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{t.teamName}</span>
              </span>
              <span style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace" }}>
                <span style={{ display: 'block', fontSize: 12 }}>
                  <span style={{ fontSize: 9, color: 'var(--text3)', marginRight: 4 }}>subs</span>
                  {t.activeSubs.toLocaleString()}
                  <span style={{ fontSize: 11, color: netColor(t.net), marginLeft: 4 }}>{signed(t.net)}</span>
                </span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text3)' }}>
                  <span style={{ fontSize: 9, marginRight: 4 }}>seg</span>
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
