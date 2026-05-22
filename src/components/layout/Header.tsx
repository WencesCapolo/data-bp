'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { useSession, signOut } from '@/lib/auth/client';

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
  const { data: session } = useSession();
  const latest = data?.sources
    .map((s) => s.lastSync)
    .sort()
    .at(-1);
  const ageH = latest ? (Date.now() - new Date(latest).getTime()) / 3_600_000 : Infinity;
  const inFlight = data?.inFlight ?? false;
  const dotClass = inFlight ? 'live' : !latest ? 'error' : ageH > 12 ? 'stale' : '';
  const badgeClass = inFlight ? 'sync-badge live' : 'sync-badge';

  return (
    <header className="header">
      <div className="logo">
        BASKET.TV
        <span className="subtitle">Analytics</span>
      </div>
      <div className="header-meta">
        <span className={badgeClass} aria-live="polite">
          <span className={`sync-dot ${dotClass}`} />
          {inFlight ? 'Sincronizando…' : latest ? `synced ${relative(latest)}` : 'no sync'}
        </span>
        <span>{new Date().toISOString().slice(0, 10)}</span>
        {session?.user && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text2)' }}>{session.user.email}</span>
            <button
              type="button"
              onClick={() => signOut({ fetchOptions: { onSuccess: () => { window.location.href = '/sign-in'; } } })}
              style={{ background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
            >
              salir
            </button>
          </span>
        )}
      </div>
    </header>
  );
}
