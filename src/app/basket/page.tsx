'use client';
import { Header } from '@/components/layout/Header';
import { TabBar } from '@/components/layout/TabBar';
import { OverviewTab } from '@/components/tabs/OverviewTab';
import { StubTab } from '@/components/tabs/StubTab';
import { DatePills } from '@/components/ui/DatePills';
import { useFilters } from '@/lib/client/filterStore';

export default function BasketDashboard() {
  const tab = useFilters((s) => s.tab);
  const range = useFilters((s) => s.range);
  const setRange = useFilters((s) => s.setRange);

  return (
    <>
      <Header />
      <TabBar />
      <main className="main">
        {tab === 'overview' && (
          <>
            <div className="filter-row">
              <span className="filter-label">Rango</span>
              <DatePills value={range} onChange={setRange} />
            </div>
            <OverviewTab />
          </>
        )}
        {tab === 'evolution' && <StubTab name="Evolución Histórica" />}
        {tab === 'teams' && <StubTab name="Análisis por Equipo" />}
        {tab === 'finance' && <StubTab name="Análisis Financiero" />}
        {tab === 'retention' && <StubTab name="Retención / Churn" />}
        {tab === 'quality' && <StubTab name="Calidad de Datos" />}
      </main>
    </>
  );
}
