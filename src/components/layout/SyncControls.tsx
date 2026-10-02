'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useSWR, { useSWRConfig } from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { SyncModal, type LastUploadInfo } from '@/components/layout/SyncModal';
import { FeeUploadModal } from '@/components/layout/FeeUploadModal';
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
  /** Who handed over the last Pagos Export, and when. */
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

/** The header's sync controls: how fresh the data is, the Sync button that
 *  opens the Upload modals, and what the last Sync or Upload reported. */
export function SyncControls() {
  const [syncErr, setSyncErr] = useState<string | null>(null);
  // Which Upload is open. The two are one screen from the user's side and two
  // flows underneath: a Pagos Export runs a Sync, a fee Export writes the fee
  // mirror and rebuilds one view.
  const [modal, setModal] = useState<'none' | 'pagos' | 'fees'>('none');
  const [uploadResult, setUploadResult] = useState<{
    rowsIngested: number;
    rowsSkipped: number;
  } | null>(null);
  const syncBtnRef = useRef<HTMLButtonElement>(null);
  const { data } = useSWR<SyncState>('/api/sync', fetcher, {
    refreshInterval: (d) => (d?.inFlight ? 3_000 : 60_000),
  });
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
    setModal('none');
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
  const dotClass = inFlight
    ? 'bg-accent animate-sync-pulse'
    : !latest
      ? 'bg-red-600'
      : ageH > 12
        ? 'bg-amber-500'
        : 'bg-[var(--ok)]';
  const persistErr = syncErr ?? data?.lastError ?? null;
  const cookieExpired = persistErr ? /Expiró la Cookie|cookie/i.test(persistErr) : false;
  const status = inFlight ? 'Sincronizando…' : latest ? `synced ${relative(latest)}` : 'no sync';

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-xs ${
          inFlight
            ? 'border-[var(--accent-border)] bg-accent-soft text-accent-strong'
            : 'border-[var(--border)] bg-surface text-n-600'
        }`}
        aria-live="polite"
        title={status}
      >
        <span className={`size-1.5 shrink-0 rounded-full ${dotClass}`} />
        <span className="hidden md:inline">{status}</span>
      </span>
      {cookieExpired && (
        <span aria-live="polite" title={persistErr ?? undefined} className="tag tag-bad">
          ⚠<span className="hidden md:inline"> Expiró la Cookie</span>
        </span>
      )}
      {uploadResult && (
        <button
          type="button"
          onClick={() => setUploadResult(null)}
          aria-live="polite"
          title="Resultado del último Upload — clic para ocultar"
          className="tag tag-ok hidden font-mono lg:inline-flex"
        >
          ✓ {uploadResult.rowsIngested.toLocaleString('es-AR')} ingresados ·{' '}
          {uploadResult.rowsSkipped.toLocaleString('es-AR')} omitidos
        </button>
      )}
      <button
        ref={syncBtnRef}
        type="button"
        onClick={() => setModal('pagos')}
        disabled={inFlight}
        aria-haspopup="dialog"
        aria-expanded={modal !== 'none'}
        title={syncErr ?? 'Subir el Pagos Export y sincronizar'}
        className={`btn-ghost ${syncErr ? 'border-[var(--accent-border)] text-accent-strong' : ''}`}
      >
        {inFlight ? '…' : '↻ Sync'}
      </button>
      {/* To <body>: the header's backdrop-blur would trap a fixed overlay inside it. */}
      {modal === 'pagos' &&
        createPortal(
          <SyncModal
            onClose={closeModal}
            onConfirm={confirmUpload}
            lastUpload={data?.lastUpload ?? null}
            syncInFlight={inFlight}
            onSwitchToFees={() => setModal('fees')}
          />,
          document.body,
        )}
      {modal === 'fees' &&
        createPortal(
          <FeeUploadModal onClose={closeModal} onSwitchToPagos={() => setModal('pagos')} />,
          document.body,
        )}
    </div>
  );
}
