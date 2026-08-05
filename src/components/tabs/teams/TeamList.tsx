'use client';
import type { TeamRankRow } from '@basket/core/dtos/TeamsDTO';
import { netColor, signed } from './format';

interface Props {
  teams: TeamRankRow[];
  selectedId?: number;
  onSelect: (teamId: number) => void;
  query: string;
  onQueryChange: (q: string) => void;
}

export function TeamList({ teams, selectedId, onSelect, query, onQueryChange }: Props) {
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
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>{t.league}</span>
              </span>
              <span style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace" }}>
                <span style={{ display: 'block', fontSize: 12 }}>{t.followers.toLocaleString()}</span>
                <span style={{ fontSize: 11, color: netColor(t.net) }}>{signed(t.net)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
