'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { KpiCard } from '@/components/ui/KpiCard';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import type { DataQualityDTO } from '@basket/core/dtos/DataQualityDTO';
import type { MetaDTO } from '@basket/core/dtos/MetaDTO';

function severityOf(issue: { code: string; count: number }): 'low' | 'med' | 'high' {
  if (issue.count === 0) return 'low';
  if (issue.code === 'payment_orphan' || issue.code === 'paid_zero_non_antel') return 'high';
  if (issue.count > 5000) return 'high';
  if (issue.count > 500) return 'med';
  return 'low';
}

const SEV_COLOR = {
  low: 'var(--text2)',
  med: 'var(--yellow)',
  high: 'var(--red)',
};

function ageBadge(iso: string): { label: string; color: string } {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { label: '—', color: 'var(--text3)' };
  const ageMin = (Date.now() - t) / 60_000;
  if (ageMin < 60) return { label: `${Math.round(ageMin)}m`, color: 'var(--green)' };
  const h = ageMin / 60;
  if (h < 12) return { label: `${h.toFixed(1)}h`, color: 'var(--green)' };
  if (h < 36) return { label: `${h.toFixed(1)}h`, color: 'var(--yellow)' };
  const d = h / 24;
  return { label: `${d.toFixed(1)}d`, color: 'var(--red)' };
}

export function DataQualityTab() {
  const { data: dq, error: dqErr, isLoading: dqLoading } = useSWR<DataQualityDTO>(
    '/api/basket/data-quality',
    fetcher,
  );
  const { data: meta } = useSWR<MetaDTO>('/api/basket/meta', fetcher);

  if (dqLoading) return <TabSkeleton kpis={4} blocks={[{ kind: 'full', height: 320 }, { kind: 'full', height: 240 }]} />;
  if (dqErr) return <ErrorBox message={dqErr.message} />;
  if (!dq) return null;

  return (
    <div>
      <div className="kpi-grid">
        <KpiCard label="Usuarios" value={dq.totals.users} variant="blue" />
        <KpiCard label="Pagos" value={dq.totals.payments} variant="green" />
        <KpiCard label="Equipos" value={dq.totals.teams} variant="yellow" />
        <KpiCard
          label="Generado"
          value={new Date(dq.generatedAt).toLocaleTimeString('es-UY')}
          sub={new Date(dq.generatedAt).toLocaleDateString('es-UY')}
        />
      </div>

      <div className="chart-full" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="chart-title" style={{ padding: '20px 24px 0' }}>
          Issues detectados
        </div>
        <table className="data-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descripción</th>
              <th style={{ textAlign: 'right' }}>Cantidad</th>
              <th style={{ textAlign: 'right' }}>% del total</th>
              <th style={{ width: 80, textAlign: 'center' }}>Severidad</th>
            </tr>
          </thead>
          <tbody>
            {dq.issues.map((i) => {
              const sev = severityOf(i);
              const total = i.code.startsWith('payment') ? dq.totals.payments : dq.totals.users;
              const pct = total > 0 ? (i.count / total) * 100 : 0;
              return (
                <tr key={i.code}>
                  <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--text3)' }}>{i.code}</td>
                  <td>{i.description}</td>
                  <td style={{ textAlign: 'right', color: SEV_COLOR[sev], fontWeight: 600 }}>
                    {i.count.toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--text3)' }}>{pct.toFixed(2)}%</td>
                  <td style={{ textAlign: 'center' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 99,
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                        background: `${SEV_COLOR[sev]}22`,
                        color: SEV_COLOR[sev],
                      }}
                    >
                      {sev}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="chart-full" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="chart-title" style={{ padding: '20px 24px 0' }}>
          Estado de sincronización
        </div>
        <table className="data-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Fuente</th>
              <th>Última sync</th>
              <th style={{ textAlign: 'right' }}>Filas</th>
              <th style={{ textAlign: 'right' }}>Antigüedad</th>
            </tr>
          </thead>
          <tbody>
            {meta?.lastSync.map((s) => {
              const a = ageBadge(s.lastSync);
              return (
                <tr key={s.source}>
                  <td style={{ fontFamily: 'DM Mono, monospace' }}>{s.source}</td>
                  <td style={{ fontSize: 11, color: 'var(--text2)' }}>
                    {new Date(s.lastSync).toLocaleString('es-UY')}
                  </td>
                  <td style={{ textAlign: 'right' }}>{s.rowCount?.toLocaleString() ?? '—'}</td>
                  <td style={{ textAlign: 'right', color: a.color, fontWeight: 600 }}>{a.label}</td>
                </tr>
              );
            }) ?? (
              <tr>
                <td colSpan={4} className="no-data">Cargando…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {meta?.dataRange && (
        <div className="alert-box">
          <div className="alert-box-title">📅 Rango de datos disponible</div>
          <div>
            Desde <strong>{meta.dataRange.minDay}</strong> hasta{' '}
            <strong>{meta.dataRange.maxDay}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

