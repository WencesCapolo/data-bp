'use client';
import { TabBar } from '@/components/layout/TabBar';
import { PageTitle } from '@/components/ui/PageTitle';
import { OverviewTab } from '@/components/tabs/OverviewTab';
import { EvolutionTab } from '@/components/tabs/EvolutionTab';
import { TeamsTab } from '@/components/tabs/TeamsTab';
import { RetentionTab } from '@/components/tabs/RetentionTab';
import { DataQualityTab } from '@/components/tabs/DataQualityTab';
import { FilterRow } from '@/components/ui/FilterRow';
import { TabBoundary } from '@/components/ui/TabBoundary';
import { UrlFilterSync } from '@/lib/client/UrlFilterSync';
import { useFilters } from '@/lib/client/filterStore';
import { findDashboard } from '@/lib/dashboards';

const DASHBOARD = findDashboard('basket-subs')!;

export function BasketDashboard() {
  const tab = useFilters((s) => s.tab);

  return (
    <>
      <UrlFilterSync />
      <PageTitle sub={DASHBOARD.description}>{DASHBOARD.title}</PageTitle>
      <TabBar />
      <div className="flex flex-col gap-6">
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
            <TabBoundary><TeamsTab /></TabBoundary>
          </>
        )}
        {tab === 'retention' && (
          <>
            <FilterRow
              showGranularity
              granularityScope="lifecycle"
              showCountries
              showAccess
              showSubType
            />
            <TabBoundary><RetentionTab /></TabBoundary>
          </>
        )}
        {tab === 'quality' && <TabBoundary><DataQualityTab /></TabBoundary>}
      </div>
    </>
  );
}
