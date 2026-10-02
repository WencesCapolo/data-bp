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
    <span className="inline-flex items-center gap-2">
      {aviso && (
        <button
          type="button"
          onClick={() => setAviso(null)}
          aria-live="polite"
          title="Clic para ocultar"
          className={`tag max-w-[360px] text-left whitespace-normal ${aviso.intent === 'ok' ? 'tag-ok' : 'tag-bad'}`}
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
