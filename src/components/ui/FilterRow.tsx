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
  // Which store slice the toggle drives; Retention keeps its own monthly default.
  granularityScope?: 'series' | 'lifecycle';
  showCountries?: boolean;
  showAccess?: boolean;
  showSubType?: boolean;
}

export function FilterRow({
  showRange = true,
  showGranularity = false,
  granularityScope = 'series',
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
    <div className="card flex flex-wrap items-center gap-x-3 gap-y-2.5 p-3.5">
      {showRange && (
        <>
          <span className="eyebrow">Rango</span>
          <DatePills value={f.range} onChange={f.setRange} />
        </>
      )}
      {showGranularity && (
        <>
          <span aria-hidden className="mx-1 h-5 w-px bg-[var(--border)] max-sm:hidden" />
          <span className="eyebrow">Granularidad</span>
          <GranularityToggle
            value={granularityScope === 'lifecycle' ? f.lifecycleGranularity : f.granularity}
            onChange={
              granularityScope === 'lifecycle' ? f.setLifecycleGranularity : f.setGranularity
            }
          />
        </>
      )}
      {showCountries && (
        <>
          <span aria-hidden className="mx-1 h-5 w-px bg-[var(--border)] max-sm:hidden" />
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
          <span aria-hidden className="mx-1 h-5 w-px bg-[var(--border)] max-sm:hidden" />
          <span className="eyebrow">Acceso</span>
          <AccessPills value={f.accessType} onChange={f.setAccessType} />
        </>
      )}
      {showSubType && (
        <>
          <span aria-hidden className="mx-1 h-5 w-px bg-[var(--border)] max-sm:hidden" />
          <span className="eyebrow">Subtipo</span>
          <SubtypePills value={f.subType} onChange={f.setSubType} />
        </>
      )}
      {showReset && (
        <>
          <span aria-hidden className="mx-1 h-5 w-px bg-[var(--border)] max-sm:hidden" />
          <button
            type="button"
            className="pill text-muted"
            onClick={f.resetFilters}
          >
            ↺ Reset
          </button>
        </>
      )}
    </div>
  );
}
