'use client';
import useSWR from 'swr';
import { fetcher } from '@/lib/client/fetcher';
import { KpiCard, KpiGrid } from '@/components/ui/KpiCard';
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

const SEV_LABEL = { low: 'baja', med: 'media', high: 'alta' } as const;

/** Spanish name + description per issue code; the code itself never reaches the UI. */
const ISSUE_LABEL: Record<string, { name: string; description: string }> = {
  user_no_country: { name: 'Usuario sin país', description: 'Usuarios sin país informado' },
  user_no_team: { name: 'Usuario sin equipo', description: 'Usuarios sin equipo promocional asignado' },
  payment_orphan: { name: 'Pago huérfano', description: 'Pagos cuyo usuario no existe en la tabla de usuarios' },
  paid_zero_non_antel: { name: 'Pago en cero', description: 'Plan pago (no Antel) con importe 0' },
  payment_failed: { name: 'Pago fallido', description: 'Pagos con estado fallido' },
};
const issueName = (code: string): string => ISSUE_LABEL[code]?.name ?? code.replace(/_/g, ' ');

const SEV_TEXT = {
  low: 'text-n-700!',
  med: 'text-amber-700!',
  high: 'text-red-700!',
} as const;

const SEV_TAG = {
  low: 'tag-neutral',
  med: 'tag-warn',
  high: 'tag-bad',
} as const;

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
    <div className="flex flex-col gap-6">
      <KpiGrid>
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
      </KpiGrid>

      <section className="card overflow-hidden">
        <h2 className="card-title flex items-center px-5 pt-5 pb-4">
          Issues detectados
          <InfoHint text="Controles de consistencia sobre la copia local. El % se calcula sobre el total de Pagos (códigos payment…) o de suscriptores (los demás). Severidad «high» si pasa de 5000 filas o si es un Pago sin suscriptor o un plan pago en $0; «med» si pasa de 500." />
        </h2>
        <div className="overflow-x-auto">
          <table className="data-table min-w-[640px]">
            <thead>
              <tr>
                <th>Problema</th>
                <th>Descripción</th>
                <th className="text-right!">Cantidad</th>
                <th className="text-right!">% del total</th>
                <th className="w-20 text-center!">Severidad</th>
              </tr>
            </thead>
            <tbody>
              {dq.issues.map((i) => {
                const sev = severityOf(i);
                const total = i.code.startsWith('payment') ? dq.totals.payments : dq.totals.users;
                const pct = total > 0 ? (i.count / total) * 100 : 0;
                return (
                  <tr key={i.code}>
                    <td className="font-semibold">{issueName(i.code)}</td>
                    <td>{ISSUE_LABEL[i.code]?.description ?? i.description}</td>
                    <td className={`text-right font-semibold tabular-nums ${SEV_TEXT[sev]}`}>
                      {i.count.toLocaleString()}
                    </td>
                    <td className="text-right text-muted! tabular-nums">{pct.toFixed(2)}%</td>
                    <td className="text-center">
                      <span className={`tag ${SEV_TAG[sev]} uppercase`}>{SEV_LABEL[sev]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card overflow-hidden">
        <h2 className="card-title flex items-center px-5 pt-5 pb-4">
          Log de sincronizaciones
          <InfoHint text="Últimas 60 entradas, la más nueva primero: cargas manuales de la exportación de Pagos, ingestas automáticas de la casilla de correo, corridas programadas y por token de acceso. Pagos = filas ingresadas. Si el estado es error, el motivo aparece al pasar el mouse por la fila." />
        </h2>
        <div className="overflow-x-auto">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Usuario</th>
                <th>Detalle</th>
                <th className="text-right!">Pagos</th>
                <th className="text-right!">Duración</th>
                <th className="w-20 text-center!">Estado</th>
              </tr>
            </thead>
            <tbody>
              {dq.syncLog.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10! text-center text-muted!">Sin registros</td>
                </tr>
              )}
              {dq.syncLog.map((e, idx) => (
                <tr key={`${e.at}-${idx}`} title={e.error ?? undefined}>
                  <td className="text-[11px] whitespace-nowrap text-n-700!">
                    {new Date(e.at).toLocaleString('es-UY')}
                  </td>
                  <td>{KIND_LABEL[e.kind] ?? e.kind}</td>
                  <td className="text-[11px] text-n-700!">{e.actor}</td>
                  <td className="font-mono text-[11px] text-muted!">{e.detail}</td>
                  <td className="text-right tabular-nums">{e.rows?.toLocaleString() ?? '—'}</td>
                  <td className="text-right text-muted! tabular-nums">{fmtDuration(e.durationMs)}</td>
                  <td className="text-center">
                    <span className={`tag uppercase ${e.error ? 'tag-bad' : 'tag-ok'}`}>{e.error ? 'error' : 'ok'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {meta?.dataRange && (
        <div className="rounded-[var(--panel-radius)] border border-sky-200 bg-sky-50 px-4 py-3.5 text-sm leading-relaxed text-n-700">
          <div className="mb-1.5 flex items-center font-display text-sm font-semibold tracking-[0.08em] text-sky-800 uppercase">
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
