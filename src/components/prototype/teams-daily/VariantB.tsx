'use client';
// PROTOTYPE Variant B — "Ficha de equipo" : master list on the left, one team's
// daily altas/bajas detail on the right. Primary affordance: drill into a team.
import { useMemo, useState } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import { KpiCard } from '@/components/ui/KpiCard';
import { ChartCanvas } from '@/components/charts/ChartCanvas';
import { useTeamsDaily, signed, netColor, bucketize, type Bucket } from './data';

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'day', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'year', label: 'Año' },
];

type Series = ReturnType<typeof bucketize>;

// Bars = altas (up) / bajas (down); line = active subscriptions that day, on its
// own axis, so the movement is read against the base it moves.
function ActiveMovementChart({ s }: { s: Series }) {
  const config = useMemo<ChartConfiguration>(() => {
    return {
      type: 'bar',
      data: {
        labels: s.labels,
        datasets: [
          {
            type: 'line',
            label: 'Suscripciones activas',
            data: s.active,
            borderColor: '#06b6d4',
            backgroundColor: 'rgba(6,182,212,.12)',
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            tension: 0.25,
            yAxisID: 'y1',
            order: 0,
          },
          {
            type: 'bar',
            label: 'Altas',
            data: s.altas,
            backgroundColor: '#10b981',
            borderRadius: 2,
            stack: 'mov',
            yAxisID: 'y',
            order: 1,
          },
          {
            type: 'bar',
            label: 'Bajas',
            data: s.bajas.map((b) => -b),
            backgroundColor: '#ef4444',
            borderRadius: 2,
            stack: 'mov',
            yAxisID: 'y',
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        resizeDelay: 120,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: {
            backgroundColor: '#0f1525',
            borderColor: '#2a3752',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${Math.abs(Number(ctx.parsed.y)).toLocaleString()}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0, autoSkipPadding: 12 } },
          y: {
            position: 'left',
            grid: { color: '#1e2a42' },
            ticks: { font: { size: 10 }, callback: (v) => Math.abs(Number(v)) },
            title: { display: true, text: 'altas / bajas', font: { size: 9 } },
          },
          y1: {
            position: 'right',
            grid: { display: false },
            beginAtZero: true,
            ticks: { font: { size: 10 }, color: '#06b6d4' },
            title: { display: true, text: 'activas', color: '#06b6d4', font: { size: 9 } },
          },
        },
      },
    };
  }, [s]);
  // Fixed-height relative box: Chart.js with maintainAspectRatio:false sizes the
  // canvas from its parent, and an auto-height parent sized by the canvas grows a
  // few px on every resize tick — the chart (and the table under it) creep down.
  return (
    <div style={{ position: 'relative', height: 280 }}>
      <ChartCanvas config={config} height={280} />
    </div>
  );
}

export function VariantB() {
  const { data, error, isLoading } = useTeamsDaily();
  const [selected, setSelected] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [bucket, setBucket] = useState<Bucket>('day');

  const list = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.teams
      .filter((t) => !needle || t.teamName.toLowerCase().includes(needle) || t.league.toLowerCase().includes(needle))
      .sort((a, b) => b.followers - a.followers);
  }, [data, q]);

  if (isLoading && !data) return <TabSkeleton kpis={4} blocks={[{ kind: 'full', height: 520 }]} />;
  if (error) return <ErrorBox message={error.message} />;
  if (!data) return null;

  const team = list.find((t) => t.teamId === selected) ?? list[0];
  if (!team) return <div className="no-data">Sin equipos</div>;

  const activeStart = team.activeByDay[0] ?? 0;
  const activeEnd = team.activeByDay[team.activeByDay.length - 1] ?? 0;
  const s = bucketize(
    data.days,
    { altas: team.altasByDay, bajas: team.bajasByDay, active: team.activeByDay },
    bucket,
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
      <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
          <input
            className="search-input"
            style={{ width: '100%' }}
            placeholder="Buscar equipo…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div style={{ maxHeight: '68vh', overflowY: 'auto' }}>
          {list.map((t) => {
            const active = t.teamId === team.teamId;
            return (
              <button
                key={t.teamId}
                onClick={() => setSelected(t.teamId)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 8,
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  background: active ? 'var(--bg3)' : 'transparent',
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
              >
                <span>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{t.teamName}</span>
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>{t.league}</span>
                </span>
                <span style={{ textAlign: 'right', fontFamily: "'DM Mono', monospace" }}>
                  <span style={{ display: 'block', fontSize: 12 }}>{t.followers.toLocaleString()}</span>
                  <span style={{ fontSize: 11, color: netColor(t.net) }}>{signed(t.net)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ minHeight: '70vh' }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{team.teamName}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            {team.league} · {team.country} · {data.from} → {data.to}
          </div>
        </div>

        <div className="kpi-grid">
          <KpiCard
            label="Suscripciones activas"
            value={activeEnd}
            variant="blue"
            sub={`${activeStart.toLocaleString()} al inicio del rango`}
            delta={{ value: `${signed(activeEnd - activeStart)} en el rango`, up: activeEnd >= activeStart }}
          />
          <KpiCard label="Altas de suscripción" value={team.altas} variant="green" />
          <KpiCard label="Bajas de suscripción" value={team.bajas} variant="red" />
          <KpiCard
            label="Variación neta"
            value={signed(team.net)}
            variant={team.net >= 0 ? 'green' : 'red'}
            sub={`sobre una base de ${activeEnd.toLocaleString()} activas`}
          />
          <KpiCard
            label="Seguidores"
            value={team.followers}
            sub={`${((team.activeNow / Math.max(1, team.followers)) * 100).toFixed(1)}% con suscripción activa`}
          />
        </div>

        <div className="chart-full">
          <div
            className="chart-title"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
          >
            <span>
              Suscripciones activas y su variación
              <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400, marginLeft: 8 }}>
                barras = altas / bajas · línea = activas al cierre del período
              </span>
            </span>
            <span className="subtype-pills">
              {BUCKETS.map((b) => (
                <button
                  key={b.key}
                  className={`subtype-pill ${bucket === b.key ? 'active' : ''}`}
                  onClick={() => setBucket(b.key)}
                >
                  {b.label}
                </button>
              ))}
            </span>
          </div>
          <ActiveMovementChart s={s} />
        </div>

        <div className="chart-full" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{BUCKETS.find((b) => b.key === bucket)?.label}</th>
                <th style={{ textAlign: 'right' }}>Activas</th>
                <th style={{ textAlign: 'right' }}>Altas</th>
                <th style={{ textAlign: 'right' }}>Bajas</th>
                <th style={{ textAlign: 'right' }}>Neto</th>
              </tr>
            </thead>
            <tbody>
              {s.keys
                .map((k, i) => ({ d: s.labels[i], key: k, a: s.altas[i], b: s.bajas[i], act: s.active[i] }))
                .filter((r) => r.a + r.b > 0)
                .reverse()
                .map((r) => (
                  <tr key={r.key}>
                    <td>{bucket === 'day' ? r.key : r.d}</td>
                    <td style={{ textAlign: 'right', color: 'var(--accent2)' }}>{r.act.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', color: 'var(--green)' }}>{r.a}</td>
                    <td style={{ textAlign: 'right', color: 'var(--red)' }}>{r.b}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: netColor(r.a - r.b) }}>
                      {signed(r.a - r.b)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
