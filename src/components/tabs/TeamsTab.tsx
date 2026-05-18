'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { useFilters } from '@/lib/client/filterStore';
import { KpiCard } from '@/components/ui/KpiCard';
import { TeamsRow } from './TeamsRow';
import type { TeamsDTO, TeamRankRow } from '@basket/core/dtos/TeamsDTO';

type SortKey = 'uniquePayers' | 'totalPayments' | 'totalAmount' | 'teamName';
type SortDir = 'asc' | 'desc';

function buildUrl(s: {
  range: string;
  countries: string[];
  accessType?: string;
  subType?: string;
}): string {
  const p = new URLSearchParams();
  p.set('range', s.range);
  p.set('limit', '100');
  for (const c of s.countries) p.append('countries', c);
  if (s.accessType) p.set('accessType', s.accessType);
  if (s.subType) p.set('subType', s.subType);
  return `/api/basket/teams?${p.toString()}`;
}

export function TeamsTab() {
  const range = useFilters((s) => s.range);
  const countries = useFilters((s) => s.countries);
  const accessType = useFilters((s) => s.accessType);
  const subType = useFilters((s) => s.subType);

  const url = buildUrl({ range, countries, accessType, subType });
  const { data, error, isLoading } = useSWR<TeamsDTO>(url, fetcher);

  const [sortKey, setSortKey] = useState<SortKey>('totalPayments');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState<number | null>(null);

  const sorted = useMemo(() => {
    if (!data?.ranked) return [];
    const arr = [...data.ranked];
    arr.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      return sortDir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return arr;
  }, [data, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir(k === 'teamName' ? 'asc' : 'desc');
    }
  }

  if (isLoading) return <SkeletonTeams />;
  if (error) return <ErrorBox message={error.message} />;
  if (!data) return null;

  const topTeam = sorted[0];

  return (
    <div>
      <div className="kpi-grid">
        <KpiCard label="Equipos con pagadores" value={data.totals.teams} />
        <KpiCard label="Pagadores únicos" value={data.totals.uniquePayers} variant="green" />
        <KpiCard label="Pagos totales" value={data.totals.totalPayments} variant="blue" />
        <KpiCard
          label="Top equipo"
          value={topTeam?.teamName ?? '—'}
          sub={topTeam ? `${topTeam.totalPayments.toLocaleString()} pagos` : ''}
          variant="yellow"
        />
      </div>

      <div className="chart-full" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <SortableTh label="Equipo" k="teamName" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <th>Liga</th>
              <th>País</th>
              <SortableTh label="Pagadores" k="uniquePayers" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortableTh label="Pagos" k="totalPayments" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortableTh label="Monto" k="totalAmount" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <TeamsRow
                key={row.teamId}
                row={row}
                rank={i + 1}
                expanded={expanded === row.teamId}
                onToggle={() => setExpanded((e) => (e === row.teamId ? null : row.teamId))}
              />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="no-data">
                  Sin datos para el rango/filtros seleccionados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortableTh({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  align = 'left',
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sortKey === k;
  return (
    <th
      onClick={() => onClick(k)}
      style={{ cursor: 'pointer', textAlign: align, userSelect: 'none' }}
    >
      {label}
      {active && <span style={{ marginLeft: 4, color: 'var(--accent)' }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

function SkeletonTeams() {
  return (
    <div>
      <div className="kpi-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 96 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 480 }} />
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="alert-box" style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)' }}>
      <div className="alert-box-title" style={{ color: 'var(--red)' }}>⚠ Error</div>
      <div style={{ fontFamily: 'DM Mono, monospace' }}>{message}</div>
    </div>
  );
}

export type { TeamRankRow };
