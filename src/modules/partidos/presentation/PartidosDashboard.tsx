'use client';
import { Header } from '@/components/layout/Header';
import { TabBoundary } from '@/components/ui/TabBoundary';
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

export function PartidosDashboard() {
  const dim = usePartidosFilters((s) => s.dim);
  return (
    <>
      <Header />
      <PartidosDimTabBar />
      <main className="main">
        {dim === 'nacional' && (
          <>
            <PartidosNacionalFiltersBar />
            <TabBoundary>
              <PartidosNacionalKpis />
              <div className="col2" style={{ marginTop: 24 }}>
                <PartidosNacionalMonthlyChart />
                <PartidosNacionalWeeklyChart />
              </div>
              <div style={{ marginTop: 24 }}>
                <PartidosNacionalChannelBreakdown />
              </div>
            </TabBoundary>
          </>
        )}
        {dim === 'intl' && (
          <>
            <PartidosIntlFiltersBar />
            <TabBoundary>
              <PartidosIntlKpis />
              <div className="col2" style={{ marginTop: 24 }}>
                <PartidosIntlMonthlyChart />
                <PartidosIntlWeeklyChart />
              </div>
              <div style={{ marginTop: 24 }}>
                <PartidosIntlChannelBreakdown />
              </div>
            </TabBoundary>
          </>
        )}
      </main>
    </>
  );
}
