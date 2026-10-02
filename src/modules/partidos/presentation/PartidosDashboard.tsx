'use client';
import { TabBoundary } from '@/components/ui/TabBoundary';
import { PageTitle } from '@/components/ui/PageTitle';
import { findDashboard } from '@/lib/dashboards';
import { usePartidosFilters } from './state/partidosFilterStore';
import { PartidosDimTabBar } from './components/PartidosDimTabBar';
import { PartidosNacionalFiltersBar } from './components/PartidosNacionalFilters';
import { PartidosIntlFiltersBar } from './components/PartidosIntlFilters';
import { PartidosNacionalKpis } from './components/PartidosNacionalKpis';
import { PartidosIntlKpis } from './components/PartidosIntlKpis';
import {
  PartidosNacionalWeeklyChart,
  PartidosNacionalMonthlyChart,
  PartidosNacionalChannelBreakdown,
} from './components/PartidosNacionalCharts';
import {
  PartidosIntlWeeklyChart,
  PartidosIntlMonthlyChart,
  PartidosIntlChannelBreakdown,
} from './components/PartidosIntlCharts';

const DASHBOARD = findDashboard('partidos')!;

export function PartidosDashboard() {
  const dim = usePartidosFilters((s) => s.dim);
  return (
    <>
      <PageTitle sub={DASHBOARD.description}>{DASHBOARD.title}</PageTitle>
      <PartidosDimTabBar />
      <div className="flex flex-col gap-6">
        {dim === 'nacional' && (
          <>
            <PartidosNacionalFiltersBar />
            <TabBoundary>
              <PartidosNacionalKpis />
              <div className="grid gap-4 md:grid-cols-2">
                <PartidosNacionalMonthlyChart />
                <PartidosNacionalWeeklyChart />
              </div>
              <PartidosNacionalChannelBreakdown />
            </TabBoundary>
          </>
        )}
        {dim === 'intl' && (
          <>
            <PartidosIntlFiltersBar />
            <TabBoundary>
              <PartidosIntlKpis />
              <div className="grid gap-4 md:grid-cols-2">
                <PartidosIntlMonthlyChart />
                <PartidosIntlWeeklyChart />
              </div>
              <PartidosIntlChannelBreakdown />
            </TabBoundary>
          </>
        )}
      </div>
    </>
  );
}
