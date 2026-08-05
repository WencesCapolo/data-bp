'use client';
import { useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { useSession, signOut } from '@/lib/auth/client';
import { swapToPortal, buildPortalLoginUrl } from '@/lib/auth/portal';
import { SyncModal, type LastUploadInfo } from '@/components/layout/SyncModal';
import type { UploadResultDTO } from '@basket/core/dtos/PaymentUploadDTO';

interface SyncState {
  sources: { source: string; lastSync: string; rowCount: number | null }[];
  inFlight: boolean;
  startedAt: string | null;
  lastError: string | null;
  /** Present once an Upload has been ingested by a Sync. `upload` is the
   *  explicit shape; `basket` is the raw sync result the endpoint already
   *  reports, from which the same counts can be read. */
  lastResult?: {
    upload?: UploadResultDTO | null;
    basket?: { syncedPayments?: number; skippedPayments?: number } | null;
  } | null;
  /** Who handed over the last Cobros Export, and when. */
  lastUpload?: LastUploadInfo | null;
}

/** Ingested/skipped counts of the Upload the last Sync consumed, if any. */
function uploadCounts(
  last: SyncState['lastResult'],
): { rowsIngested: number; rowsSkipped: number } | null {
  if (last?.upload) {
    return { rowsIngested: last.upload.rowsIngested, rowsSkipped: last.upload.rowsSkipped };
  }
  const b = last?.basket;
  if (b && typeof b.syncedPayments === 'number') {
    return { rowsIngested: b.syncedPayments, rowsSkipped: b.skippedPayments ?? 0 };
  }
  return null;
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
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    rowsIngested: number;
    rowsSkipped: number;
  } | null>(null);
  const syncBtnRef = useRef<HTMLButtonElement>(null);
  const { data } = useSWR<SyncState>('/api/sync', fetcher, {
    refreshInterval: (d) => (d?.inFlight ? 3_000 : 60_000),
  });
  const { data: session } = useSession();
  const { mutate } = useSWRConfig();
  const wasInFlight = useRef(false);

  useEffect(() => {
    const now = data?.inFlight ?? false;
    if (wasInFlight.current && !now) {
      mutate(
        (key) =>
          typeof key === 'string' &&
          (key.startsWith('/api/basket/') || key.startsWith('/api/partidos/')) &&
          key !== '/api/sync',
        undefined,
        { revalidate: true },
      );
      if (data?.lastError) setSyncErr(data.lastError);
      const counts = uploadCounts(data?.lastResult);
      if (counts) setUploadResult(counts);
    }
    wasInFlight.current = now;
  }, [data?.inFlight, data?.lastError, data?.lastResult, mutate]);

  /** POSTs /api/sync, optionally confirming a staged Upload. Throws on failure. */
  async function runSync(uploadId?: string): Promise<'started' | 'already_running'> {
    setSyncErr(null);
    setUploadResult(null);
    const res = await fetch('/api/sync', {
      method: 'POST',
      ...(uploadId
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId }) }
        : {}),
    });
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    if (res.status !== 202 && !res.ok) throw new Error(String(body?.error ?? `HTTP ${res.status}`));
    await mutate('/api/sync');
    return res.status === 202 && body?.status === 'already_running' ? 'already_running' : 'started';
  }

  function closeModal() {
    setModalOpen(false);
    syncBtnRef.current?.focus();
  }

  async function confirmUpload(uploadId: string): Promise<'started' | 'already_running'> {
    try {
      return await runSync(uploadId);
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  const latest = data?.sources
    .map((s) => s.lastSync)
    .sort()
    .at(-1);
  const ageH = latest ? (Date.now() - new Date(latest).getTime()) / 3_600_000 : Infinity;
  const inFlight = data?.inFlight ?? false;
  const dotClass = inFlight ? 'live' : !latest ? 'error' : ageH > 12 ? 'stale' : '';
  const badgeClass = inFlight ? 'sync-badge live' : 'sync-badge';
  const persistErr = syncErr ?? data?.lastError ?? null;
  const cookieExpired = persistErr ? /Expiró la Cookie|cookie/i.test(persistErr) : false;

  return (
    <header className={inFlight ? 'header in-flight' : 'header'}>
      <a href="/" className="logo" aria-label="Basket.tv">
        <img src="/Basket.tv%20horizontal%20blanco.png" alt="Basket.tv" className="logo-img" />
        <span className="subtitle">Analytics</span>
      </a>
      <div className="header-meta">
        <span className={badgeClass} aria-live="polite">
          <span className={`sync-dot ${dotClass}`} />
          {inFlight ? 'Sincronizando…' : latest ? `synced ${relative(latest)}` : 'no sync'}
        </span>
        {cookieExpired && (
          <span
            aria-live="polite"
            title={persistErr ?? undefined}
            style={{
              background: 'var(--red)',
              color: 'white',
              borderRadius: 6,
              padding: '2px 10px',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            ⚠ Expiró la Cookie
          </span>
        )}
        {uploadResult && (
          <button
            type="button"
            onClick={() => setUploadResult(null)}
            aria-live="polite"
            title="Resultado del último Upload — clic para ocultar"
            style={{
              background: 'transparent',
              color: 'var(--green)',
              border: '1px solid color-mix(in srgb, var(--green) 40%, transparent)',
              borderRadius: 6,
              padding: '2px 10px',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: "'DM Mono', monospace",
            }}
          >
            ✓ {uploadResult.rowsIngested.toLocaleString('es-AR')} ingresados ·{' '}
            {uploadResult.rowsSkipped.toLocaleString('es-AR')} omitidos
          </button>
        )}
        <button
          ref={syncBtnRef}
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={inFlight}
          aria-haspopup="dialog"
          aria-expanded={modalOpen}
          title={syncErr ?? 'Subir el Cobros Export y sincronizar'}
          style={{
            background: inFlight ? 'transparent' : 'var(--bg3)',
            color: syncErr ? 'var(--red)' : 'var(--text2)',
            border: `1px solid ${syncErr ? 'var(--red)' : 'var(--border)'}`,
            borderRadius: 6,
            padding: '4px 10px',
            cursor: inFlight ? 'not-allowed' : 'pointer',
            fontSize: 11,
            fontFamily: 'inherit',
            opacity: inFlight ? 0.6 : 1,
            transition: 'all 0.15s',
          }}
        >
          {inFlight ? '…' : '↻ Sync'}
        </button>
        <span className="header-date">{new Date().toISOString().slice(0, 10)}</span>
        {session?.user && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="header-email" style={{ color: 'var(--text2)' }}>{session.user.email}</span>
            <button
              type="button"
              onClick={() => signOut({ fetchOptions: { onSuccess: () => { window.location.href = buildPortalLoginUrl(swapToPortal(window.location.origin)); } } })}
              style={{ background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
            >
              salir
            </button>
          </span>
        )}
      </div>
      {modalOpen && (
        <SyncModal
          onClose={closeModal}
          onConfirm={confirmUpload}
          lastUpload={data?.lastUpload ?? null}
          syncInFlight={inFlight}
        />
      )}
    </header>
  );
}
