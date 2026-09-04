'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { KpiCard } from '@/components/ui/KpiCard';
import { InfoHint } from '@/components/ui/InfoHint';
import { TabSkeleton } from '@/components/ui/Skeleton';
import { ErrorBox } from '@/components/ui/ErrorBox';
import type { DataQualityDTO, SyncLogEntry } from '@basket/core/dtos/DataQualityDTO';
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

const KIND_LABEL: Record<SyncLogEntry['kind'], string> = {
  manual: 'Manual · Pagos',
  inbox: 'Inbox MP',
  cron: 'Cron',
  token: 'Token',
};

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
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
        <KpiCard
          label="Usuarios"
          value={dq.totals.users}
          variant="blue"
          hint="Total de suscriptores (cuentas de la Plataforma) en la copia local, sin filtro de fecha ni de actividad. Se actualiza con cada sincronización."
        />
        <KpiCard
          label="Pagos"
          value={dq.totals.payments}
          variant="green"
          hint="Total de Pagos en la copia local, incluidos los intentos fallidos. Entran por cargas de la exportación de Pagos y por las sincronizaciones automáticas."
        />
        <KpiCard
          label="Equipos"
          value={dq.totals.teams}
          variant="yellow"
          hint="Total de equipos conocidos en la copia local. Son los que se usan para asignar el equipo favorito de cada suscriptor en la pestaña Equipos."
        />
        <KpiCard
          label="Generado"
          value={new Date(dq.generatedAt).toLocaleTimeString('es-UY')}
          sub={new Date(dq.generatedAt).toLocaleDateString('es-UY')}
          hint="Momento en que se calcularon estos conteos, es decir, cuando se abrió esta pestaña. No es la fecha de la última sincronización: esa se ve en el registro de abajo."
        />
      </div>

      <div className="chart-full" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="chart-title" style={{ padding: '20px 24px 0' }}>
          Issues detectados
          <InfoHint text="Controles de consistencia sobre la copia local. El % se calcula sobre el total de Pagos (códigos payment…) o de suscriptores (los demás). Severidad «high» si pasa de 5000 filas o si es un Pago sin suscriptor o un plan pago en $0; «med» si pasa de 500." />
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
          Log de sincronizaciones
          <InfoHint text="Últimas 60 entradas, la más nueva primero: cargas manuales de la exportación de Pagos, ingestas automáticas de la casilla de correo, corridas programadas y por token de acceso. Pagos = filas ingresadas. Si el estado es error, el motivo aparece al pasar el mouse por la fila." />
        </div>
        <table className="data-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Usuario</th>
              <th>Detalle</th>
              <th style={{ textAlign: 'right' }}>Pagos</th>
              <th style={{ textAlign: 'right' }}>Duración</th>
              <th style={{ width: 80, textAlign: 'center' }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {dq.syncLog.length === 0 && (
              <tr>
                <td colSpan={7} className="no-data">Sin registros</td>
              </tr>
            )}
            {dq.syncLog.map((e, idx) => {
              const color = e.error ? 'var(--red)' : 'var(--green)';
              return (
                <tr key={`${e.at}-${idx}`} title={e.error ?? undefined}>
                  <td style={{ fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                    {new Date(e.at).toLocaleString('es-UY')}
                  </td>
                  <td>{KIND_LABEL[e.kind] ?? e.kind}</td>
                  <td style={{ fontSize: 11, color: 'var(--text2)' }}>{e.actor}</td>
                  <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--text3)' }}>{e.detail}</td>
                  <td style={{ textAlign: 'right' }}>{e.rows?.toLocaleString() ?? '—'}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text3)' }}>{fmtDuration(e.durationMs)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 99,
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                        background: `${color}22`,
                        color,
                      }}
                    >
                      {e.error ? 'error' : 'ok'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {meta?.dataRange && (
        <div className="alert-box">
          <div className="alert-box-title">
            📅 Rango de datos disponible
            <InfoHint text="Primer y último día con suscripciones activas calculadas: desde el Pago exitoso más antiguo hasta hoy o hasta el último vencimiento más 7 días, lo que ocurra antes. Fuera de este rango los gráficos no tienen datos." />
          </div>
          <div>
            Desde <strong>{meta.dataRange.minDay}</strong> hasta{' '}
            <strong>{meta.dataRange.maxDay}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

