'use client';
import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { TabBoundary } from '@/components/ui/TabBoundary';
import { FinancieroView } from '@/components/financiero/FinancieroView';
import { ContenidoView } from '@/components/financiero/ContenidoView';
import { FinancieroHero } from '@/components/financiero/financiero/Hero';
import { FinancieroFilters } from '@/components/financiero/financiero/Filters';

/**
 * La página del prototipo, pieza por pieza: el hero rojo, el `wrap` que se le
 * monta encima, las dos pills (Suscriptores · Contenido) y debajo la vista.
 * Los filtros también son los del prototipo — pestañas por país, selects de
 * fecha, chips — pero escriben en el store compartido de la app. Lo único
 * ajeno al prototipo es el "?" de cada tarjeta.
 *
 * El `Header` de la app queda arriba porque trae lo que el prototipo no tenía:
 * el Sync, la sesión y el tema.
 */
type FinView = 'financiero' | 'contenido';

const VIEWS: { key: FinView; label: string; icon: string }[] = [
  { key: 'financiero', label: 'Suscriptores', icon: '📊' },
  { key: 'contenido', label: 'Contenido', icon: '🏀' },
];

export function FinancieroDashboard({ email }: { email: string }) {
  const [view, setView] = useState<FinView>('financiero');

  return (
    <>
      <Header email={email} />
      <div className="proto-page">
        <FinancieroHero />
        <div className="proto-wrap">
          <div className="primary-nav" role="tablist" aria-label="Vista">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                role="tab"
                aria-selected={view === v.key}
                className={`primary-pill ${view === v.key ? 'active' : ''}`}
                onClick={() => setView(v.key)}
              >
                <span aria-hidden>{v.icon}</span>
                {v.label}
              </button>
            ))}
          </div>

          {view === 'contenido' && (
            <TabBoundary><ContenidoView /></TabBoundary>
          )}
          {view === 'financiero' && (
            <>
              <FinancieroFilters />
              <TabBoundary><FinancieroView /></TabBoundary>
            </>
          )}
        </div>
      </div>
    </>
  );
}
