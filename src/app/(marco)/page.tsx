import { requireSession } from '@/lib/auth/rbac';
import { dashboardsForRole, findDashboard } from '@/lib/dashboards';
import { DashboardCard } from '@/components/landing/DashboardCard';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ denied?: string }>;
}

export default async function Inicio({ searchParams }: Props) {
  const user = await requireSession();
  const dashboards = dashboardsForRole(user.role);
  const { denied } = await searchParams;
  const deniedDash = denied ? findDashboard(denied) : null;

  return (
    <>
      <section>
        <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">Dashboards</h1>
        <p className="mt-2 text-sm text-muted">Elegí un dashboard para abrirlo.</p>
      </section>

      {deniedDash && (
        <div role="alert" className="rounded-[var(--panel-radius)] border border-[var(--accent-border)] bg-accent-soft px-4 py-3 text-sm text-accent-strong">
          No tenés permiso para ver <strong>{deniedDash.title}</strong>. Pedile acceso a un admin.
        </div>
      )}

      {dashboards.length === 0 ? (
        <div className="card px-5 py-4 text-sm text-muted">No tenés ningún dashboard asignado.</div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {dashboards.map((d) => (
            <DashboardCard key={d.slug} dashboard={d} />
          ))}
        </div>
      )}
    </>
  );
}
