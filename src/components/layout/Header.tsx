'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';

interface SyncState {
  sources: { source: string; lastSync: string; rowCount: number | null }[];
  inFlight: boolean;
}

function relative(iso: string): string {
  const d = new Date(iso).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function Header() {
  const { data } = useSWR<SyncState>('/api/basket/sync', fetcher, { refreshInterval: 60_000 });
  const latest = data?.sources
    .map((s) => s.lastSync)
    .sort()
    .at(-1);
  const ageH = latest ? (Date.now() - new Date(latest).getTime()) / 3_600_000 : Infinity;
  const dotClass = !latest ? 'error' : ageH > 12 ? 'stale' : '';

  return (
    <header className="header">
      <div className="logo">
        BASKET.TV
        <span className="subtitle">Analytics</span>
      </div>
      <div className="header-meta">
        <span className="sync-badge">
          <span className={`sync-dot ${dotClass}`} />
          {data?.inFlight ? 'syncing…' : latest ? `synced ${relative(latest)}` : 'no sync'}
        </span>
        <span>{new Date().toISOString().slice(0, 10)}</span>
      </div>
    </header>
  );
}
