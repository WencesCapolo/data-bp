'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FEE_EXPORT_SOURCES,
  MAX_FEE_UPLOAD_BYTES,
  type FeeExportSourceId,
  type FeeUploadPreviewDTO,
  type FeeUploadRejection,
  type FeeUploadResultDTO,
} from '@basket/core/dtos/FeeUploadDTO';
import { ADVICE, M, dropzone } from './modalStyles';

/**
 * The Upload screen's second source: a Provider's own fee Export.
 *
 * Its own dialog rather than another branch inside `SyncModal`, because the two
 * flows only look alike. A Pagos Upload stages a CSV and then runs a full Sync;
 * this one accepts a workbook, writes one table and rebuilds one view, and has
 * no Sync to wait for — so it ends on a result rather than on "sincronizando".
 * Sharing a component would have meant every button and every message asking
 * which flow it was in.
 */

interface Props {
  onClose: () => void;
  /** Back to the Pagos Upload — the two are one screen from the user's side. */
  onSwitchToPagos: () => void;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

function isRejection(body: unknown): body is FeeUploadRejection {
  return (
    typeof body === 'object' && body !== null &&
    typeof (body as FeeUploadRejection).error === 'string' &&
    typeof (body as FeeUploadRejection).message === 'string'
  );
}

function isPreview(body: unknown): body is FeeUploadPreviewDTO {
  return (
    typeof body === 'object' && body !== null &&
    typeof (body as FeeUploadPreviewDTO).uploadId === 'string' &&
    typeof (body as FeeUploadPreviewDTO).rows === 'number'
  );
}

function fmtNum(n: number): string {
  return n.toLocaleString('es-AR');
}

function fmtMoney(n: number, currency: string): string {
  return `${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FeeUploadModal({ onClose, onSwitchToPagos }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sourceId, setSourceId] = useState<FeeExportSourceId>(FEE_EXPORT_SOURCES[0].id);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [preview, setPreview] = useState<FeeUploadPreviewDTO | null>(null);
  const [result, setResult] = useState<FeeUploadResultDTO | null>(null);
  const [rejection, setRejection] = useState<FeeUploadRejection | null>(null);

  const spec = FEE_EXPORT_SOURCES.find((s) => s.id === sourceId) ?? FEE_EXPORT_SOURCES[0];
  const busy = uploading || ingesting;

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
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const list = Array.from(nodes).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
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
    [busy, onClose],
  );

  function pick(next: File | null) {
    setRejection(null);
    if (next && next.size > MAX_FEE_UPLOAD_BYTES) {
      const mb = Math.floor(MAX_FEE_UPLOAD_BYTES / (1024 * 1024));
      setRejection({
        error: 'too_large',
        message:
          `El archivo pesa ${fmtSize(next.size)} y el máximo es ${mb} MB. ` +
          'Pedile al panel de MercadoPago un Window más corto: ofrece uno.',
      });
      setFile(null);
      return;
    }
    setFile(next);
  }

  async function analyse() {
    if (!file || uploading) return;
    setUploading(true);
    setRejection(null);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('source', sourceId);
      const res = await fetch('/api/basket/fees/upload', { method: 'POST', body });
      const json: unknown = await res.json().catch(() => null);
      if (isRejection(json)) {
        setRejection(json);
        setFile(null);
        return;
      }
      if (res.status === 401) {
        setRejection({
          error: 'bad_format',
          message: 'Tu sesión expiró. Recargá la página para volver a iniciar sesión y reintentá.',
        });
        setFile(null);
        return;
      }
      if (!res.ok || !isPreview(json)) {
        setRejection({ error: 'bad_format', message: `No se pudo analizar el archivo (HTTP ${res.status}).` });
        setFile(null);
        return;
      }
      setPreview(json);
    } catch (e) {
      setRejection({
        error: 'bad_format',
        message: e instanceof Error ? e.message : 'No se pudo subir el archivo.',
      });
      setFile(null);
    } finally {
      setUploading(false);
    }
  }

  async function confirm() {
    if (!preview || ingesting) return;
    setIngesting(true);
    setRejection(null);
    try {
      const res = await fetch('/api/basket/fees/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId: preview.uploadId,
          source: preview.source,
          filename: preview.filename,
        }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (isRejection(json)) {
        setRejection(json);
        // The staged file is gone after a confirm attempt, so there is nothing
        // to go back to: the way to retry is to upload the file again.
        setPreview(null);
        setFile(null);
        return;
      }
      if (!res.ok) {
        setRejection({ error: 'bad_format', message: `No se pudo cargar el archivo (HTTP ${res.status}).` });
        return;
      }
      setResult(json as FeeUploadResultDTO);
      setPreview(null);
    } catch (e) {
      setRejection({
        error: 'bad_format',
        message: e instanceof Error ? e.message : 'No se pudo cargar el archivo.',
      });
    } finally {
      setIngesting(false);
    }
  }

  const step = result ? 3 : preview ? 2 : 1;

  return (
    <div
      className={M.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fee-modal-title"
        tabIndex={-1}
        className={M.dialog}
        onKeyDown={onKeyDown}
      >
        <div className={M.head}>
          <h2 className={M.title} id="fee-modal-title">
            {step === 3 ? 'Comisiones cargadas' : step === 2 ? 'Revisar el Export de comisiones' : 'Subir un Export de comisiones'}
          </h2>
          <span className={M.step}>
            paso {step} de 3
          </span>
        </div>

        <div className={M.body}>
          {step === 1 && (
            <>
              <p className={M.intro}>
                Este Export lo entrega el Provider, no nuestro Control Panel: es lo que{' '}
                <strong>nos cobró</strong>. No dispara un Sync — escribe las comisiones y
                reconstruye la vista que las lee.
              </p>

              <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Provider">
                {FEE_EXPORT_SOURCES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="pill"
                    aria-pressed={s.id === sourceId}
                    onClick={() => {
                      setSourceId(s.id);
                      setFile(null);
                      setRejection(null);
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <ul className={M.checklist}>
                <li>{spec.hint}</li>
                <li>
                  Un <strong>archivo por mes</strong>: el panel limita el rango de cada reporte,
                  así que los meses llegan de a uno.
                </li>
                <li>
                  Se acepta <strong>.xlsx</strong> y <strong>.csv</strong>. Si las columnas de
                  importes no cierran contra el neto, el archivo se rechaza antes de escribir nada.
                </li>
              </ul>

              {rejection && (
                <div className={ADVICE.error} role="alert">
                  {rejection.message}
                </div>
              )}

              <input
                ref={inputRef}
                type="file"
                accept={spec.accept}
                aria-label={`Export de ${spec.label}`}
                className="hidden"
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className={dropzone({ dragging, hasFile: Boolean(file) })}
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
                    <div className="mb-1 text-[13px] text-foreground">{file.name}</div>
                    <div className="text-[11px] text-muted">
                      {fmtSize(file.size)} · clic para elegir otro
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mb-1 text-[13px] text-foreground">
                      Arrastrá el archivo acá
                    </div>
                    <div className="text-[11px] text-muted">
                      o hacé clic para buscarlo en tu equipo
                    </div>
                  </>
                )}
              </button>

              <p className={`mt-3 ${M.note}`}>
                ¿Buscabas el Export de <strong>Pagos</strong> del Control Panel?{' '}
                <button
                  type="button"
                  onClick={onSwitchToPagos}
                  className={M.link}
                >
                  Subirlo por acá
                </button>
                .
              </p>
            </>
          )}

          {preview && (
            <>
              <p className={M.intro}>
                Todavía no se escribió nada. {preview.sourceLabel} · {preview.platformName}.
              </p>

              <div className={M.stats}>
                <div className={M.stat}>
                  <div className={M.statLabel}>Operaciones</div>
                  <div className={M.statValue}>{fmtNum(preview.rows)}</div>
                </div>
                <div className={M.stat}>
                  <div className={M.statLabel}>Comisión</div>
                  <div className={`${M.statValue} text-red-700`}>
                    {preview.feePct}%
                  </div>
                </div>
                <div className={M.stat}>
                  <div className={M.statLabel}>Retención</div>
                  <div className={`${M.statValue} text-amber-700`}>
                    {preview.taxPct}%
                  </div>
                </div>
                <div className={M.stat}>
                  <div className={M.statLabel}>Con Pago en el espejo</div>
                  <div className={`${M.statValue} text-[var(--ok)]`}>
                    {fmtNum(preview.matchedPagos)}
                  </div>
                </div>
              </div>

              <p className={`mb-3.5 ${M.note}`}>
                La comisión se gasta; la retención vuelve como crédito fiscal. Se guardan en
                columnas distintas justamente para no sumarlas y decir que el Provider cuesta
                cuatro veces lo que cobra.
              </p>

              <div className="mb-4">
                <div className={M.statLabel}>Importes</div>
                <div className={M.kv}>
                  <span className="text-foreground">Bruto</span>
                  <span>{fmtMoney(preview.grossTotal, preview.currency)}</span>
                </div>
                <div className={M.kv}>
                  <span className="text-foreground">Comisión</span>
                  <span>{fmtMoney(preview.feeTotal, preview.currency)}</span>
                </div>
                <div className={M.kv}>
                  <span className="text-foreground">Retención</span>
                  <span>{fmtMoney(preview.taxTotal, preview.currency)}</span>
                </div>
                <div className={M.kv}>
                  <span className="text-foreground">Neto</span>
                  <span>{fmtMoney(preview.netTotal, preview.currency)}</span>
                </div>
              </div>

              <div className="mb-4">
                <div className={M.statLabel}>Window</div>
                <div className={M.kv}>
                  <span>
                    {fmtDate(preview.windowFrom)} → {fmtDate(preview.windowTo)}
                  </span>
                  <span className="text-muted">{preview.filename}</span>
                </div>
              </div>

              {Object.keys(preview.byStatus).length > 0 && (
                <div className="mb-4">
                  <div className={M.statLabel}>Por estado</div>
                  {Object.entries(preview.byStatus)
                    .sort((a, b) => b[1] - a[1])
                    .map(([status, count]) => (
                      <div className={M.kv} key={status}>
                        <span className="text-foreground">{status}</span>
                        <span>{fmtNum(count)}</span>
                      </div>
                    ))}
                </div>
              )}

              {preview.warnings.map((w) => (
                <div className={ADVICE.warn} key={`${w.code}:${w.count ?? 0}`} role="status">
                  {w.message}
                </div>
              ))}
              {rejection && (
                <div className={ADVICE.error} role="alert">
                  {rejection.message}
                </div>
              )}
            </>
          )}

          {result && (
            <>
              <div className={M.stats}>
                <div className={M.stat}>
                  <div className={M.statLabel}>Filas escritas</div>
                  <div className={`${M.statValue} text-[var(--ok)]`}>
                    {fmtNum(result.upserted)}
                  </div>
                </div>
                <div className={M.stat}>
                  <div className={M.statLabel}>Window</div>
                  <div className={`${M.statValue} text-[13px]`}>
                    {fmtDate(result.windowFrom)} → {fmtDate(result.windowTo)}
                  </div>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-n-700">
                {result.viewRefreshMs === null ? (
                  <>
                    Las comisiones quedaron guardadas, pero la vista no se pudo reconstruir ahora.
                    El cron la rehace en la próxima corrida y los números aparecen entonces.
                  </>
                ) : (
                  <>
                    Vista de netos diarios reconstruida en{' '}
                    {fmtNum(result.viewRefreshMs)} ms: los netos de /financiero ya incluyen este mes.
                  </>
                )}
              </p>
            </>
          )}
        </div>

        <div className={M.foot}>
          {preview && (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setFile(null);
              }}
            >
              Volver
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            {result ? 'Cerrar' : 'Cancelar'}
          </button>
          {step === 1 && (
            <button
              type="button"
              className={M.primary}
              disabled={!file || uploading}
              onClick={analyse}
            >
              {uploading ? 'Analizando…' : 'Analizar Export'}
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              className={M.primary}
              disabled={ingesting}
              onClick={confirm}
            >
              {ingesting ? 'Cargando…' : 'Confirmar y cargar'}
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              className={M.primary}
              onClick={() => {
                setResult(null);
                setFile(null);
              }}
            >
              Subir otro mes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
