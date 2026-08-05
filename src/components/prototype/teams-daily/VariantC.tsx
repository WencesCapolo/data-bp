'use client';
// PROTOTYPE Variant C — "Diario" : day-first feed. Each day is an entry listing
// which teams gained and lost subscribers, with a followers leaderboard rail.
// Primary affordance: answer "qué pasó ayer / esta semana".
import { useMemo, useState } from 'react';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { useTeamsDaily, fmtDay, signed, netColor } from './data';

const TOP_CHIPS = 6;

export function VariantC() {
  const { data, error, isLoading } = useTeamsDaily();
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());

  const feed = useMemo(() => {
    if (!data) return [];
    return data.days
      .map((d, i) => {
        const movers = data.teams
          .map((t) => ({
            teamId: t.teamId,
            teamName: t.teamName,
            followers: t.followers,
            altas: t.altasByDay[i],
            bajas: t.bajasByDay[i],
            net: t.altasByDay[i] - t.bajasByDay[i],
          }))
          .filter((m) => m.altas + m.bajas > 0);
        return {
          day: d,
          altas: data.daily[i].altas,
          bajas: data.daily[i].bajas,
          net: data.daily[i].net,
          gainers: movers.filter((m) => m.net > 0).sort((a, b) => b.net - a.net),
          losers: movers.filter((m) => m.net < 0).sort((a, b) => a.net - b.net),
          teamsTouched: movers.length,
        };
      })
      .reverse();
  }, [data]);

  if (isLoading && !data) return <TabSkeleton kpis={4} blocks={[{ kind: 'full', height: 520 }]} />;
  if (error) return <ErrorBox message={error.message} />;
  if (!data) return null;

  const leaderboard = [...data.teams].sort((a, b) => b.followers - a.followers).slice(0, 18);
  const maxFollowers = Math.max(1, ...leaderboard.map((t) => t.followers));

  return (
    <div>
      <div className="chart-full">
        <div className="chart-title">
          Variación diaria de suscripciones · {data.totals.altas.toLocaleString()} altas /{' '}
          {data.totals.bajas.toLocaleString()} bajas · neto{' '}
          <span style={{ color: netColor(data.totals.net) }}>{signed(data.totals.net)}</span>
        </div>
        <StackedBarChart
          labels={data.days.map(fmtDay)}
          series={[
            { label: 'Altas', data: data.daily.map((d) => d.altas), color: '#10b981' },
            { label: 'Bajas', data: data.daily.map((d) => -d.bajas), color: '#ef4444' },
          ]}
          height={220}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {feed.map((f) => {
            const open = openDays.has(f.day);
            const gainers = open ? f.gainers : f.gainers.slice(0, TOP_CHIPS);
            const losers = open ? f.losers : f.losers.slice(0, TOP_CHIPS);
            return (
              <div key={f.day} className="chart-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{f.day}</span>
                    <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>
                      {f.teamsTouched} equipos con movimiento
                    </span>
                  </div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14 }}>
                    <span style={{ color: 'var(--green)' }}>+{f.altas}</span>
                    <span style={{ color: 'var(--text3)' }}> / </span>
                    <span style={{ color: 'var(--red)' }}>-{f.bajas}</span>
                    <span style={{ marginLeft: 10, fontWeight: 700, color: netColor(f.net) }}>{signed(f.net)}</span>
                  </div>
                </div>

                {f.teamsTouched === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>Sin movimiento</div>
                )}

                {gainers.length > 0 && <ChipRow title="Ganan" items={gainers} tone="green" />}
                {losers.length > 0 && <ChipRow title="Pierden" items={losers} tone="red" />}

                {(f.gainers.length > TOP_CHIPS || f.losers.length > TOP_CHIPS) && (
                  <button
                    className="btn-ghost"
                    style={{ marginTop: 10, fontSize: 11 }}
                    onClick={() =>
                      setOpenDays((s) => {
                        const next = new Set(s);
                        if (next.has(f.day)) next.delete(f.day);
                        else next.add(f.day);
                        return next;
                      })
                    }
                  >
                    {open ? 'Ver menos' : `Ver los ${f.teamsTouched} equipos`}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="chart-card" style={{ position: 'sticky', top: 16 }}>
          <div className="chart-title">Seguidores por equipo</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {leaderboard.map((t, i) => (
              <div key={t.teamId}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: 'var(--text2)' }}>
                    <span className="rank-num">{i + 1}</span> {t.teamName}
                  </span>
                  <span style={{ fontFamily: "'DM Mono', monospace" }}>
                    {t.followers.toLocaleString()}
                    <span style={{ color: netColor(t.net), marginLeft: 6 }}>{signed(t.net)}</span>
                  </span>
                </div>
                <div className="country-bar">
                  <div
                    className="country-bar-fill"
                    style={{ width: `${(t.followers / maxFollowers) * 100}%`, background: 'var(--accent2)' }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text3)' }}>
            Total seguidores: {data.totals.followers.toLocaleString()} · activos:{' '}
            {data.totals.activeNow.toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChipRow({
  title,
  items,
  tone,
}: {
  title: string;
  items: { teamId: number; teamName: string; net: number; followers: number }[];
  tone: 'green' | 'red';
}) {
  const color = tone === 'green' ? 'var(--green)' : 'var(--red)';
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((m) => (
          <span
            key={m.teamId}
            title={`${m.teamName} · ${m.followers.toLocaleString()} seguidores`}
            style={{
              display: 'inline-flex',
              gap: 6,
              alignItems: 'center',
              fontSize: 11,
              padding: '4px 9px',
              borderRadius: 999,
              border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
              background: `color-mix(in srgb, ${color} 12%, transparent)`,
            }}
          >
            {m.teamName}
            <strong style={{ color, fontFamily: "'DM Mono', monospace" }}>{signed(m.net)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
