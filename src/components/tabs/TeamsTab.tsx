'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { buildFilterQS, useFilters } from '@/lib/client/filterStore';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import { TeamList } from './teams/TeamList';
import { TeamDetail } from './teams/TeamDetail';
import type { TeamsDTO } from '@basket/core/dtos/TeamsDTO';

const LIST_LIMIT = 100;

export function TeamsTab() {
  const range = useFilters((s) => s.range);
  const countries = useFilters((s) => s.countries);
  const accessType = useFilters((s) => s.accessType);
  const subType = useFilters((s) => s.subType);

  const filterQS = buildFilterQS({ range, countries, accessType, subType });
  const { data, error, isLoading } = useSWR<TeamsDTO>(
    `/api/basket/teams?${filterQS}&limit=${LIST_LIMIT}`,
    fetcher,
    { keepPreviousData: true },
  );

  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    return data.ranked
      .filter(
        (t) =>
          !needle ||
          t.teamName.toLowerCase().includes(needle) ||
          t.league.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.followers - a.followers);
  }, [data, query]);

  if (isLoading && !data) {
    return <TabSkeleton kpis={5} blocks={[{ kind: 'full', height: 520 }]} />;
  }
  if (error) return <ErrorBox message={error.message} />;
  if (!data) return null;

  // The selection defaults to the first team, and falls back to it when the
  // current pick drops out of the filtered list.
  const team = list.find((t) => t.teamId === selected) ?? list[0];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
      <TeamList
        teams={list}
        selectedId={team?.teamId}
        onSelect={setSelected}
        query={query}
        onQueryChange={setQuery}
      />
      {/* min-height keeps the skeleton → data swap from jumping the layout. */}
      <div style={{ minHeight: '70vh' }}>
        {team ? (
          <TeamDetail team={team} filterQS={filterQS} from={data.from} to={data.to} />
        ) : (
          <div className="no-data">Sin equipos para el rango/filtros seleccionados</div>
        )}
      </div>
    </div>
  );
}
