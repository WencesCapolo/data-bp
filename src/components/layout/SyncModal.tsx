'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_UPLOAD_BYTES,
  type UploadPreviewDTO,
  type UploadRejection,
} from '@basket/core/dtos/PaymentUploadDTO';

/** Last Upload, as the sync endpoint reports it. Everything is optional: the
 *  modal simply hides the line when the API does not provide it. */
export interface LastUploadInfo {
  filename?: string | null;
  uploadedBy?: string | null;
  uploadedAt?: string | null;
}

interface SyncModalProps {
  /** Close without doing anything; the Header returns focus to the Sync button. */
  onClose: () => void;
  /** Posts `{ uploadId }` to /api/sync and revalidates. Resolves with the sync
   *  endpoint's verdict so the modal can report an already-running Sync. */
  onConfirm: (uploadId: string) => Promise<'started' | 'already_running'>;
  lastUpload?: LastUploadInfo | null;
  /** A Sync is already running; confirming is pointless until it settles. */
  syncInFlight: boolean;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

function isRejection(body: unknown): body is UploadRejection {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as UploadRejection).error === 'string' &&
    typeof (body as UploadRejection).message === 'string'
  );
}

function isPreview(body: unknown): body is UploadPreviewDTO {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as UploadPreviewDTO).uploadId === 'string' &&
    typeof (body as UploadPreviewDTO).rowTotal === 'number'
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${fmtDate(iso)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString('es-AR');
}

/** The one message for "too big", whoever says so: our own ceiling check, the
 *  endpoint's `too_large` rejection, or a reverse proxy answering 413 before the
 *  request ever reaches Next.js. */
function tooLargeMessage(bytes?: number): string {
  const max = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));
  const actual = typeof bytes === 'number' ? ` (el archivo pesa ${fmtSize(bytes)})` : '';
  return (
    `El servidor rechazó el archivo por tamaño${actual}. El máximo es ${max} MB. ` +
    'Descargá el Export de un período más corto y volvé a intentarlo. ' +
    'Si el archivo está por debajo del máximo, avisale al equipo: el límite lo está ' +
    'poniendo el reverse proxy, no la aplicación.'
  );
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SyncModal({ onClose, onConfirm, lastUpload, syncInFlight }: SyncModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<UploadPreviewDTO | null>(null);
  const [rejection, setRejection] = useState<UploadRejection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const busy = uploading || confirming;

  useEffect(() => {
    dialogRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const list = Array.from(nodes).filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  function pick(next: File | null) {
    setRejection(null);
    setNotice(null);
    if (next && next.size > MAX_UPLOAD_BYTES) {
      setRejection({ error: 'too_large', message: tooLargeMessage(next.size) });
      setFile(null);
      return;
    }
    setFile(next);
  }

  async function upload() {
    if (!file || uploading) return;
    setUploading(true);
    setRejection(null);
    setNotice(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/basket/payments/upload', { method: 'POST', body });
      const json: unknown = await res.json().catch(() => null);
      if (isRejection(json)) {
        setRejection(json);
        setFile(null);
        return;
      }
      // 413 never comes from the endpoint — it rejects with `too_large` and a 400.
      // A 413 here is a proxy in front of Next.js capping the body, and its reply
      // is HTML, so there is no JSON rejection to show.
      if (res.status === 413) {
        setRejection({ error: 'too_large', message: tooLargeMessage(file.size) });
        setFile(null);
        return;
      }
      if (res.status === 401) {
        setRejection({
          error: 'not_csv',
          message: 'Tu sesión expiró. Recargá la página para volver a iniciar sesión y reintentá.',
        });
        setFile(null);
        return;
      }
      if (!res.ok || !isPreview(json)) {
        setRejection({
          error: 'not_csv',
          message: `No se pudo analizar el archivo (HTTP ${res.status}).`,
        });
        setFile(null);
        return;
      }
      setPreview(json);
    } catch (e) {
      setRejection({
        error: 'not_csv',
        message: e instanceof Error ? e.message : 'No se pudo subir el archivo.',
      });
      setFile(null);
    } finally {
      setUploading(false);
    }
  }

  async function confirm() {
    if (!preview || confirming) return;
    setConfirming(true);
    setNotice(null);
    try {
      const verdict = await onConfirm(preview.uploadId);
      if (verdict === 'already_running') {
        setNotice('Ya hay un Sync en curso. Esperá a que termine y volvé a intentarlo.');
        return;
      }
      onClose();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'No se pudo iniciar el Sync.');
    } finally {
      setConfirming(false);
    }
  }

  const providers = preview ? Object.entries(preview.byProvider) : [];

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-modal-title"
        tabIndex={-1}
        className="modal-dialog"
        onKeyDown={onKeyDown}
      >
        <div className="modal-head">
          <h2 className="modal-title" id="sync-modal-title">
            {preview ? 'Revisar el Pagos Export' : 'Subir el Pagos Export'}
          </h2>
          <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'DM Mono', monospace" }}>
            paso {preview ? 2 : 1} de 2
          </span>
        </div>

        <div className="modal-body">
          {!preview && (
            <>
              <p style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 14 }}>
                Descargá el Export desde el Control Panel y subilo acá. Antes de subirlo,
                revisá estos tres puntos:
              </p>
              <ul className="modal-checklist">
                <li>
                  Descargalo en formato <strong>CSV</strong>, no en Excel. Los archivos{' '}
                  <strong>.xls</strong> o <strong>.xlsx</strong> se rechazan.
                </li>
                <li>
                  Elegí un rango de fechas que cubra <strong>más de un mes</strong>. Un rango
                  más corto deja huecos en los Pagos.
                </li>
                <li>
                  Tiene que ser el Export de <strong>Pagos</strong>, no el de{' '}
                  <strong>Suscripciones</strong>. Las dos exportaciones tienen las mismas
                  columnas y se confunden fácil.
                </li>
              </ul>

              {rejection && (
                <div className="modal-advice is-error" role="alert">
                  {rejection.message}
                </div>
              )}
              {notice && (
                <div className="modal-advice is-info" role="status">
                  {notice}
                </div>
              )}

              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                aria-label="Pagos Export en CSV"
                style={{ display: 'none' }}
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className={`dropzone${dragging ? ' is-dragging' : ''}${file ? ' has-file' : ''}`}
                disabled={uploading}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const dropped = e.dataTransfer.files?.[0];
                  if (dropped) pick(dropped);
                }}
                onClick={() => inputRef.current?.click()}
              >
                {file ? (
                  <>
                    <div style={{ color: 'var(--text)', fontSize: 13, marginBottom: 4 }}>
                      {file.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {fmtSize(file.size)} · clic para elegir otro
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ color: 'var(--text)', fontSize: 13, marginBottom: 4 }}>
                      Arrastrá el CSV acá
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                      o hacé clic para buscarlo en tu equipo
                    </div>
                  </>
                )}
              </button>

              {lastUpload?.uploadedAt && (
                <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 12, fontFamily: "'DM Mono', monospace" }}>
                  Último Upload: {fmtDateTime(lastUpload.uploadedAt)}
                  {lastUpload.uploadedBy ? ` · ${lastUpload.uploadedBy}` : ''}
                  {lastUpload.filename ? ` · ${lastUpload.filename}` : ''}
                </p>
              )}
            </>
          )}

          {preview && (
            <>
              <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14, lineHeight: 1.6 }}>
                Todavía no se escribió nada. Revisá el resumen y confirmá para lanzar el Sync.
              </p>

              <div className="modal-stats">
                <div className="modal-stat">
                  <div className="modal-stat-label">Filas</div>
                  <div className="modal-stat-value">{fmtNum(preview.rowTotal)}</div>
                </div>
                <div className="modal-stat">
                  <div className="modal-stat-label">Aprobados</div>
                  <div className="modal-stat-value" style={{ color: 'var(--green)' }}>
                    {fmtNum(preview.approved)}
                  </div>
                </div>
                <div className="modal-stat">
                  <div className="modal-stat-label">Rechazados</div>
                  <div className="modal-stat-value" style={{ color: 'var(--red)' }}>
                    {fmtNum(preview.rejected)}
                  </div>
                </div>
                <div className="modal-stat">
                  <div className="modal-stat-label">Pendientes</div>
                  <div className="modal-stat-value" style={{ color: 'var(--yellow)' }}>
                    {fmtNum(preview.pending)}
                  </div>
                </div>
                {preview.otherNotApproved > 0 && (
                  <div className="modal-stat">
                    <div className="modal-stat-label">Otros no aprobados</div>
                    <div className="modal-stat-value" style={{ color: 'var(--text2)' }}>
                      {fmtNum(preview.otherNotApproved)}
                    </div>
                  </div>
                )}
                <div className="modal-stat">
                  <div className="modal-stat-label">Se omitirían</div>
                  <div className="modal-stat-value" style={{ color: 'var(--yellow)' }}>
                    {fmtNum(preview.wouldSkip)}
                  </div>
                </div>
              </div>

              {preview.pending > 0 && (
                <p style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 14, lineHeight: 1.6 }}>
                  Los Pendientes no son fallas: son Pagos en efectivo (Rapipago, PagoFácil) que el
                  Suscriptor todavía puede ir a pagar, y muchos terminan aprobados.
                </p>
              )}

              <div style={{ marginBottom: 16 }}>
                <div className="modal-stat-label">Window</div>
                <div className="modal-kv">
                  <span>
                    {fmtDate(preview.windowFrom)} → {fmtDate(preview.windowTo)}
                  </span>
                  <span style={{ color: 'var(--text3)' }}>
                    {preview.windowDays === null ? 'sin fechas' : `${fmtNum(preview.windowDays)} días`}
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div className="modal-stat-label">Por Provider</div>
                {providers.length === 0 ? (
                  <div className="modal-kv">
                    <span>sin Providers</span>
                  </div>
                ) : (
                  providers
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, count]) => (
                      <div className="modal-kv" key={name}>
                        <span style={{ color: 'var(--text)' }}>{name}</span>
                        <span>{fmtNum(count)}</span>
                      </div>
                    ))
                )}
              </div>

              <div className="modal-kv" style={{ marginBottom: 16 }}>
                <span>{preview.filename}</span>
                <span style={{ color: 'var(--text3)' }}>{fmtSize(preview.byteSize)}</span>
              </div>

              {preview.warnings.map((w) => (
                <div className="modal-advice is-warn" key={w.code} role="status">
                  {w.message}
                  {typeof w.count === 'number' ? ` (${fmtNum(w.count)})` : ''}
                </div>
              ))}

              {notice && (
                <div className="modal-advice is-info" role="status">
                  {notice}
                </div>
              )}
              {syncInFlight && !notice && (
                <div className="modal-advice is-info" role="status">
                  Hay un Sync en curso. Esperá a que termine para confirmar este Upload.
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-foot">
          {preview && (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setFile(null);
                setNotice(null);
              }}
            >
              Volver
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          {!preview ? (
            <button
              type="button"
              className="btn-primary"
              style={{ padding: '8px 14px', fontSize: 13 }}
              disabled={!file || uploading}
              onClick={upload}
            >
              {uploading ? 'Analizando…' : 'Analizar Export'}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              style={{ padding: '8px 14px', fontSize: 13 }}
              disabled={confirming || syncInFlight}
              onClick={confirm}
            >
              {confirming ? 'Iniciando…' : 'Confirmar y sincronizar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
