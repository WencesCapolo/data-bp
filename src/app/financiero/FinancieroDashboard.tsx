'use client';
import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { FilterRow } from '@/components/ui/FilterRow';
import { TabBoundary } from '@/components/ui/TabBoundary';
import { FinancieroView } from '@/components/financiero/FinancieroView';
import { ContenidoView } from '@/components/financiero/ContenidoView';

/**
 * Un nivel de navegación, como el prototipo: las pills cambian de **vista** —
 * dinero o catálogo, dos sujetos que no comparten filtro ni eje.
 *
 * Antes había un segundo nivel de pestañas dentro de Financiero (Economía ·
 * Suscripciones · Real vs Plan). Se fue: `public/dashboard.html` es un scroll
 * único y partirlo en tres escondía dos tercios de la pantalla detrás de
 * pestañas que no muestran números. Los dos cortes que faltan siguen dichos,
 * pero en el sitio donde iría cada gráfico y no en una pestaña vacía — así se
 * ve *qué* falta, no sólo que falta algo.
 */
type FinView = 'financiero' | 'contenido';

const VIEWS: { key: FinView; label: string; icon: string }[] = [
  { key: 'financiero', label: 'Financiero', icon: '📊' },
  { key: 'contenido', label: 'Contenido', icon: '🏀' },
];

export function FinancieroDashboard() {
  const [view, setView] = useState<FinView>('financiero');

  return (
    <>
      <Header />

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

      <main className="main">
        {view === 'contenido' && (
          <TabBoundary><ContenidoView /></TabBoundary>
        )}
        {view === 'financiero' && (
          <>
            <FilterRow showCountries showAccess showSubType />
            <TabBoundary><FinancieroView /></TabBoundary>
          </>
        )}
      </main>
    </>
  );
}
