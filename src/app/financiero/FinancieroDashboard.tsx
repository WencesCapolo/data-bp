'use client';
import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { FilterRow } from '@/components/ui/FilterRow';
import { TabBoundary } from '@/components/ui/TabBoundary';
import { EconomiaTab } from '@/components/financiero/EconomiaTab';
import { ContenidoView } from '@/components/financiero/ContenidoView';

// Two levels of navigation, as the prototype has them. The pills switch VIEW —
// money or catalogue, two subjects that share no filter and no axis. Tabs sit
// inside a view and switch the cut of one subject. Flattening the two into a
// single six-item bar was the version that read worst: it implied Contenido
// answers the same question as Economía with a different chart.
type FinView = 'financiero' | 'contenido';
type FinTab = 'economia' | 'suscripciones' | 'plan';

/**
 * Why a tab is not showing numbers, which are two different sentences and the
 * prototype does not distinguish them:
 *
 *   pendiente      the data does not exist yet and no code can make it exist.
 *                  Suscripciones waits on MercadoPago's *planes de suscripción*
 *                  Export — a file a human has to generate.
 *   en desarrollo  the data exists and the screen is being built against it.
 *                  Real vs Plan needs the targets Sheet shared with the service
 *                  account, and nothing else.
 *
 * A reader who sees `pendiente` on both learns nothing about which one is worth
 * asking about.
 */
type TabStatus = 'ready' | 'pendiente' | 'en desarrollo';

const VIEWS: { key: FinView; label: string; icon: string }[] = [
  { key: 'financiero', label: 'Financiero', icon: '📊' },
  { key: 'contenido', label: 'Contenido', icon: '🏀' },
];

const TABS: { key: FinTab; label: string; status: TabStatus }[] = [
  { key: 'economia', label: 'Economía', status: 'ready' },
  { key: 'suscripciones', label: 'Suscripciones', status: 'pendiente' },
  { key: 'plan', label: 'Real vs Plan', status: 'en desarrollo' },
];

export function FinancieroDashboard() {
  const [view, setView] = useState<FinView>('financiero');
  const [tab, setTab] = useState<FinTab>('economia');

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

      {view === 'financiero' && (
        <div className="tabs" role="tablist" aria-label="Corte">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.status !== 'ready' && (
                <span
                  className="badge"
                  style={{ marginLeft: 6, background: 'var(--bg3)', color: 'var(--text3)' }}
                >
                  {t.status}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <main className="main">
        {view === 'contenido' && (
          <TabBoundary><ContenidoView /></TabBoundary>
        )}
        {view === 'financiero' && tab === 'economia' && (
          <>
            <FilterRow showCountries showAccess showSubType />
            <TabBoundary><EconomiaTab /></TabBoundary>
          </>
        )}
        {view === 'financiero' && tab === 'plan' && (
          <div className="no-data">
            En desarrollo · falta la planilla de objetivos. Compartir la hoja en
            modo lectura con <code>wenceslao@dashboards-496312.iam.gserviceaccount.com</code>{' '}
            y declarar <code>GOOGLE_SHEETS_ID_TARGETS</code> y{' '}
            <code>GOOGLE_SHEETS_TAB_TARGETS</code>. La hoja sólo debe traer{' '}
            <code>plan</code> — <code>real</code> y el mes anterior se calculan
            acá — y cada objetivo va en la moneda del Proveedor. Ver
            docs/handoff/financiero-dashboard-port.md
          </div>
        )}
        {view === 'financiero' && tab === 'suscripciones' && (
          <div className="no-data">
            Pendiente · esta sección espera sus fuentes de datos. Las Suscripciones
            de MercadoPago viven en el Export de planes de suscripción, que todavía
            no tiene tabla. Ver docs/handoff/financiero-dashboard-port.md
          </div>
        )}
      </main>
    </>
  );
}
