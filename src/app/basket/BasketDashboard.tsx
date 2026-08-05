'use client';
import { Header } from '@/components/layout/Header';
import { TabBar } from '@/components/layout/TabBar';
import { OverviewTab } from '@/components/tabs/OverviewTab';
import { EvolutionTab } from '@/components/tabs/EvolutionTab';
import { TeamsTab } from '@/components/tabs/TeamsTab';
import { FinanceTab } from '@/components/tabs/FinanceTab';
import { RetentionTab } from '@/components/tabs/RetentionTab';
import { DataQualityTab } from '@/components/tabs/DataQualityTab';
import { FilterRow } from '@/components/ui/FilterRow';
import { TabBoundary } from '@/components/ui/TabBoundary';
import { UrlFilterSync } from '@/lib/client/UrlFilterSync';
import { useFilters } from '@/lib/client/filterStore';
// PROTOTYPE: ?variant=A|B|C swaps the Equipos tab for the teams-daily prototype.
import { useEffect, useState } from 'react';
import { TeamsDailyPrototype } from '@/components/prototype/teams-daily';

export function BasketDashboard() {
  const tab = useFilters((s) => s.tab);
  const [prototype, setPrototype] = useState(false);
  useEffect(() => {
    setPrototype(new URLSearchParams(window.location.search).has('variant'));
  }, []);

  return (
    <>
      <UrlFilterSync />
      <Header />
      <TabBar />
      <main className="main">
        {tab === 'overview' && (
          <>
            <FilterRow showCountries showAccess showSubType />
            <TabBoundary><OverviewTab /></TabBoundary>
          </>
        )}
        {tab === 'evolution' && (
          <>
            <FilterRow showGranularity showCountries showAccess showSubType />
            <TabBoundary><EvolutionTab /></TabBoundary>
          </>
        )}
        {tab === 'teams' && (
          <>
            <FilterRow showCountries showAccess showSubType />
            <TabBoundary>{prototype ? <TeamsDailyPrototype /> : <TeamsTab />}</TabBoundary>
          </>
        )}
        {tab === 'finance' && (
          <>
            <FilterRow showCountries showAccess showSubType />
            <TabBoundary><FinanceTab /></TabBoundary>
          </>
        )}
        {tab === 'retention' && <TabBoundary><RetentionTab /></TabBoundary>}
        {tab === 'quality' && <TabBoundary><DataQualityTab /></TabBoundary>}
      </main>
    </>
  );
}
