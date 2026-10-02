'use client';
import { useState } from 'react';
import { TabBoundary } from '@/components/ui/TabBoundary';
import { PageTitle } from '@/components/ui/PageTitle';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { findDashboard } from '@/lib/dashboards';
import { FinancieroView } from '@/components/financiero/FinancieroView';
import { ContenidoView } from '@/components/financiero/ContenidoView';
import { FinancieroStats } from '@/components/financiero/financiero/Stats';
import { FinancieroFilters } from '@/components/financiero/financiero/Filters';

/**
 * La página: el título, las cinco cifras de cabecera, las dos vistas
 * (Suscriptores · Contenido) y debajo la vista elegida. Los filtros — pestañas
 * por país, selects de fecha, chips — escriben en el store compartido de la app.
 */
type FinView = 'financiero' | 'contenido';

const DASHBOARD = findDashboard('financiero')!;

const VIEWS: { key: FinView; label: string; icon: string }[] = [
  { key: 'financiero', label: 'Suscriptores', icon: '📊' },
  { key: 'contenido', label: 'Contenido', icon: '🏀' },
];

export function FinancieroDashboard() {
  const [view, setView] = useState<FinView>('financiero');

  return (
    <>
      <PageTitle sub={DASHBOARD.description}>{DASHBOARD.title}</PageTitle>
      <FinancieroStats />
      <SegmentedTabs tabs={VIEWS} value={view} onChange={setView} label="Vista" />

      {view === 'contenido' && (
        <TabBoundary><ContenidoView /></TabBoundary>
      )}
      {view === 'financiero' && (
        <>
          <FinancieroFilters />
          <TabBoundary><FinancieroView /></TabBoundary>
        </>
      )}
    </>
  );
}
