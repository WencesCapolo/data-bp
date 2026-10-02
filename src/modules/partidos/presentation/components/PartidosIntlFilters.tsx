'use client';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { usePartidosFilters } from '../state/partidosFilterStore';
import { useIntlMeta } from '../hooks/usePartidosData';

export function PartidosIntlFiltersBar() {
  const f = usePartidosFilters((s) => s.intl);
  const set = usePartidosFilters((s) => s.setIntl);
  const reset = usePartidosFilters((s) => s.resetIntl);
  const { data: meta } = useIntlMeta();

  if (!meta) return <div className="card h-[62px]" />;

  return (
    <div className="card flex flex-wrap items-center gap-x-3 gap-y-2.5 p-3.5">
      <MultiSelect
        label="Temporadas"
        options={meta.seasons}
        value={f.seasons ?? []}
        onChange={(v) => set({ seasons: v })}
      />
      <MultiSelect
        label="Países"
        options={meta.countries}
        value={f.countries ?? []}
        onChange={(v) => set({ countries: v })}
      />
      <MultiSelect
        label="Ligas"
        options={meta.leagues}
        value={f.leagues ?? []}
        onChange={(v) => set({ leagues: v })}
      />
      <select
        className="input py-1.5 text-xs"
        value={f.monthFrom ?? ''}
        onChange={(e) => set({ monthFrom: e.target.value || null })}
      >
        <option value="">Desde mes…</option>
        {meta.months.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <select
        className="input py-1.5 text-xs"
        value={f.monthTo ?? ''}
        onChange={(e) => set({ monthTo: e.target.value || null })}
      >
        <option value="">Hasta mes…</option>
        {meta.months.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <button type="button" className="pill text-muted" onClick={reset}>
        Limpiar
      </button>
    </div>
  );
}
