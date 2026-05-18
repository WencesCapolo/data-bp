'use client';
import { Header } from '@/components/layout/Header';
import { TabBar } from '@/components/layout/TabBar';
import { OverviewTab } from '@/components/tabs/OverviewTab';
import { EvolutionTab } from '@/components/tabs/EvolutionTab';
import { TeamsTab } from '@/components/tabs/TeamsTab';
import { FinanceTab } from '@/components/tabs/FinanceTab';
import { RetentionTab } from '@/components/tabs/RetentionTab';
import { StubTab } from '@/components/tabs/StubTab';
import { FilterRow } from '@/components/ui/FilterRow';
import { useFilters } from '@/lib/client/filterStore';

export default function BasketDashboard() {
  const tab = useFilters((s) => s.tab);

  return (
    <>
      <Header />
      <TabBar />
      <main className="main">
        {tab === 'overview' && (
          <>
            <FilterRow showCountries showAccess showSubType />
            <OverviewTab />
          </>
        )}
        {tab === 'evolution' && (
          <>
            <FilterRow showGranularity showCountries showAccess showSubType />
            <EvolutionTab />
          </>
        )}
        {tab === 'teams' && (
          <>
            <FilterRow showCountries showAccess showSubType />
            <TeamsTab />
          </>
        )}
        {tab === 'finance' && (
          <>
            <FilterRow showCountries showAccess showSubType />
            <FinanceTab />
          </>
        )}
        {tab === 'retention' && <RetentionTab />}
        {tab === 'quality' && <StubTab name="Calidad de Datos" />}
      </main>
    </>
  );
}
