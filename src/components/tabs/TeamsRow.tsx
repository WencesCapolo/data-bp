'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { LineChart } from '@/components/charts/LineChart';
import type { TeamRankRow, TeamTrendDTO } from '@basket/core/dtos/TeamsDTO';

function fmt(n: number): string {
  return n.toLocaleString('es-UY');
}
function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

export function TeamsRow({
  row,
  rank,
  expanded,
  onToggle,
}: {
  row: TeamRankRow;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: 'pointer' }}
        className={expanded ? 'row-active' : ''}
      >
        <td style={{ color: 'var(--text3)' }}>{rank}</td>
        <td style={{ fontWeight: 500 }}>{row.teamName}</td>
        <td style={{ color: 'var(--text2)' }}>{row.league}</td>
        <td style={{ color: 'var(--text2)' }}>{row.teamCountry}</td>
        <td style={{ textAlign: 'right' }}>{fmt(row.uniquePayers)}</td>
        <td style={{ textAlign: 'right' }}>{fmt(row.totalPayments)}</td>
        <td style={{ textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>{fmtMoney(row.totalAmount)}</td>
        <td style={{ textAlign: 'center', color: 'var(--text3)' }}>{expanded ? '▾' : '▸'}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} style={{ padding: 0, background: 'var(--bg3)' }}>
            <TrendPanel teamId={row.teamId} />
          </td>
        </tr>
      )}
    </>
  );
}

function TrendPanel({ teamId }: { teamId: number }) {
  const { data, error, isLoading } = useSWR<TeamTrendDTO>(
    `/api/basket/teams/${teamId}/trend`,
    fetcher,
  );

  if (isLoading) {
    return (
      <div style={{ padding: 16 }}>
        <div className="skeleton" style={{ height: 120 }} />
      </div>
    );
  }
  if (error) {
    return <div style={{ padding: 16, color: 'var(--red)', fontSize: 12 }}>Error: {error.message}</div>;
  }
  if (!data || data.points.length === 0) {
    return <div style={{ padding: 16, color: 'var(--text3)', fontSize: 12 }}>Sin histórico</div>;
  }

  return (
    <div style={{ padding: '16px 20px' }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text3)',
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginBottom: 8,
        }}
      >
        Tendencia mensual · {data.teamName}
      </div>
      <div style={{ height: 140 }}>
        <LineChart
          height={140}
          labels={data.points.map((p) => p.month.slice(0, 7))}
          series={[
            { label: 'Pagadores', data: data.points.map((p) => p.uniquePayers), color: '#10b981', fill: true },
          ]}
        />
      </div>
    </div>
  );
}
