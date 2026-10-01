'use client';
import { useState } from 'react';
import { CampanaDeSolicitudes, type SolicitudPendiente } from 'basket-tv-ui';
import type { DecisionResult } from '@/app/actions/access-requests';

interface Props {
  solicitudes: SolicitudPendiente[];
  aprobar: (formData: FormData) => Promise<DecisionResult>;
  rechazar: (formData: FormData) => Promise<DecisionResult>;
}

// The basket-tv-ui bell with this app's actions. The actions answer a notice
// instead of redirecting (the dashboards keep their filters in the URL); the
// list refreshes because they revalidate.
export function SolicitudesBell({ solicitudes, aprobar, rechazar }: Props) {
  const [aviso, setAviso] = useState<DecisionResult | null>(null);

  return (
    <span className="campana-solicitudes" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {aviso && (
        <button
          type="button"
          onClick={() => setAviso(null)}
          aria-live="polite"
          title="Clic para ocultar"
          style={{
            background: 'transparent',
            color: aviso.intent === 'ok' ? 'var(--green)' : 'var(--red)',
            border: `1px solid color-mix(in srgb, ${aviso.intent === 'ok' ? 'var(--green)' : 'var(--red)'} 40%, transparent)`,
            borderRadius: 6,
            padding: '2px 10px',
            fontSize: 11,
            cursor: 'pointer',
            maxWidth: 360,
            textAlign: 'left',
          }}
        >
          {aviso.notice}
        </button>
      )}
      <CampanaDeSolicitudes
        solicitudes={solicitudes}
        aprobar={async (formData) => setAviso(await aprobar(formData))}
        rechazar={async (formData) => setAviso(await rechazar(formData))}
      />
    </span>
  );
}
