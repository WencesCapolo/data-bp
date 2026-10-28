'use client';
import { useEffect } from 'react';

/** The fallback of the route error boundaries; the error goes to basket-telemetry. */
export function ErrorScreen({ error, retry, boundary }: { error: Error & { digest?: string }; retry: () => void; boundary: string }) {
  useEffect(() => {
    window.bpt?.captureError(error, { boundary, digest: error.digest ?? null });
  }, [error, boundary]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-6">
      <div role="alert" className="card px-6 py-5">
        <div className="eyebrow text-accent-strong">Error</div>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">Algo salió mal</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          No pudimos mostrar esta página. El error quedó registrado; probá de nuevo en un momento.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" className="btn-primary" onClick={retry}>
            Reintentar
          </button>
          {/* A full load on purpose: the app state may be what broke. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="btn-secondary">
            Ir al inicio
          </a>
        </div>
      </div>
    </main>
  );
}
