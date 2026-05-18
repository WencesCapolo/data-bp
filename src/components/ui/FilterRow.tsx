'use client';
import useSWR from 'swr';
import { useFilters } from '@/lib/client/filterStore';
import { fetcher } from '@/lib/client/fetcher';
import { DatePills } from './DatePills';
import { MultiSelect } from './MultiSelect';
import { AccessPills } from './AccessPills';
import { SubtypePills } from './SubtypePills';
import { GranularityToggle } from './GranularityToggle';
import type { MetaDTO } from '@basket/core/dtos/MetaDTO';

interface Props {
  showRange?: boolean;
  showGranularity?: boolean;
  showCountries?: boolean;
  showAccess?: boolean;
  showSubType?: boolean;
}

export function FilterRow({
  showRange = true,
  showGranularity = false,
  showCountries = false,
  showAccess = false,
  showSubType = false,
}: Props) {
  const f = useFilters();
  const { data: meta } = useSWR<MetaDTO>(
    showCountries ? '/api/basket/meta' : null,
    fetcher,
  );

  const showReset =
    f.countries.length > 0 || f.accessType !== undefined || f.subType !== undefined;

  return (
    <div className="filter-row">
      {showRange && (
        <>
          <span className="filter-label">Rango</span>
          <DatePills value={f.range} onChange={f.setRange} />
        </>
      )}
      {showGranularity && (
        <>
          <span className="filter-divider" />
          <span className="filter-label">Granularidad</span>
          <GranularityToggle value={f.granularity} onChange={f.setGranularity} />
        </>
      )}
      {showCountries && (
        <>
          <span className="filter-divider" />
          <MultiSelect
            label="Países"
            options={meta?.countries ?? []}
            value={f.countries}
            onChange={f.setCountries}
          />
        </>
      )}
      {showAccess && (
        <>
          <span className="filter-divider" />
          <span className="filter-label">Acceso</span>
          <AccessPills value={f.accessType} onChange={f.setAccessType} />
        </>
      )}
      {showSubType && (
        <>
          <span className="filter-divider" />
          <span className="filter-label">Subtipo</span>
          <SubtypePills value={f.subType} onChange={f.setSubType} />
        </>
      )}
      {showReset && (
        <>
          <span className="filter-divider" />
          <button
            type="button"
            className="date-pill"
            onClick={f.resetFilters}
            style={{ color: 'var(--text3)' }}
          >
            ↺ Reset
          </button>
        </>
      )}
    </div>
  );
}
