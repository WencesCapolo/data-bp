'use client';
// PROTOTYPE Variant A — "Grilla" : one dense matrix, teams (rows) x days (cols),
// cell = net variation. Primary affordance: scan the whole board at once.
import { useMemo, useState } from 'react';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import { useTeamsDaily, fmtDay, signed, type TeamDailyRow } from './data';

type Sort = 'followers' | 'net' | 'altas' | 'bajas' | 'name';

export function VariantA() {
  const { data, error, isLoading } = useTeamsDaily();
  const [sort, setSort] = useState<Sort>('followers');
  const [onlyMovement, setOnlyMovement] = useState(true);
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.teams;
    if (onlyMovement) r = r.filter((t) => t.altas + t.bajas > 0);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      r = r.filter((t) => t.teamName.toLowerCase().includes(needle) || t.league.toLowerCase().includes(needle));
    }
    const by: Record<Sort, (a: TeamDailyRow, b: TeamDailyRow) => number> = {
      followers: (a, b) => b.followers - a.followers,
      net: (a, b) => b.net - a.net,
      altas: (a, b) => b.altas - a.altas,
      bajas: (a, b) => b.bajas - a.bajas,
      name: (a, b) => a.teamName.localeCompare(b.teamName),
    };
    return [...r].sort(by[sort]);
  }, [data, sort, onlyMovement, q]);

  if (isLoading && !data) return <TabSkeleton kpis={0} blocks={[{ kind: 'full', height: 560 }]} />;
  if (error) return <ErrorBox message={error.message} />;
  if (!data) return null;

  const peak = Math.max(
    1,
    ...rows.flatMap((t) => t.altasByDay.map((a, i) => Math.abs(a - t.bajasByDay[i]))),
  );

  function cell(net: number) {
    if (net === 0) return { background: 'transparent', color: 'var(--text3)' };
    const strength = Math.min(1, 0.18 + Math.abs(net) / peak);
    const hue = net > 0 ? 'var(--green)' : 'var(--red)';
    return {
      background: `color-mix(in srgb, ${hue} ${Math.round(strength * 70)}%, transparent)`,
      color: 'var(--text)',
    };
  }

  return (
    <div>
      <div className="filter-row" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="filter-label">Orden</span>
          <div className="subtype-pills">
            {(['followers', 'net', 'altas', 'bajas', 'name'] as Sort[]).map((k) => (
              <button
                key={k}
                className={`subtype-pill ${sort === k ? 'active' : ''}`}
                onClick={() => setSort(k)}
              >
                {k === 'followers' ? 'seguidores' : k === 'name' ? 'nombre' : k}
              </button>
            ))}
          </div>
          <label className="toggle-label">
            <input type="checkbox" checked={onlyMovement} onChange={(e) => setOnlyMovement(e.target.checked)} />
            solo con movimiento
          </label>
        </div>
        <div className="search-wrap">
          <input
            className="search-input"
            placeholder="Filtrar equipo o liga…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="chart-full" style={{ padding: 0, overflow: 'auto', maxHeight: '70vh' }}>
        <table className="data-table" style={{ fontFamily: "'DM Mono', monospace" }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, zIndex: 3, background: 'var(--bg3)', minWidth: 230 }}>
                Equipo
              </th>
              <th style={{ textAlign: 'right' }}>Seg.</th>
              <th style={{ textAlign: 'right' }}>Activos</th>
              <th style={{ textAlign: 'right' }}>Neto</th>
              {data.days.map((d) => (
                <th key={d} style={{ textAlign: 'center', fontSize: 9, whiteSpace: 'nowrap' }}>
                  {fmtDay(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.teamId}>
                <td style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--bg2)' }}>
                  <div style={{ fontWeight: 600 }}>{t.teamName}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>{t.league}</div>
                </td>
                <td style={{ textAlign: 'right' }}>{t.followers.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: 'var(--accent2)' }}>{t.activeNow.toLocaleString()}</td>
                <td
                  style={{
                    textAlign: 'right',
                    fontWeight: 700,
                    color: t.net > 0 ? 'var(--green)' : t.net < 0 ? 'var(--red)' : 'var(--text3)',
                  }}
                >
                  {signed(t.net)}
                </td>
                {data.days.map((d, i) => {
                  const net = t.altasByDay[i] - t.bajasByDay[i];
                  return (
                    <td
                      key={d}
                      title={`${t.teamName} · ${d}\n+${t.altasByDay[i]} altas / -${t.bajasByDay[i]} bajas`}
                      style={{ textAlign: 'center', fontSize: 10, padding: '4px 2px', ...cell(net) }}
                    >
                      {net === 0 ? '·' : signed(net)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="no-data" colSpan={4 + data.days.length}>
                  Sin movimiento en el rango
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text3)' }}>
        {data.from} → {data.to} · alta = pasa a activo ese día · baja = deja de estar activo (incluye 7 días de gracia)
      </div>
    </div>
  );
}
