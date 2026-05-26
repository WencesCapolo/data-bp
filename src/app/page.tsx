import { requireSession } from '@/lib/auth/rbac';
import { dashboardsForRole, findDashboard } from '@/lib/dashboards';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { DashboardCard } from '@/components/landing/DashboardCard';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ denied?: string }>;
}

export default async function Home({ searchParams }: Props) {
  const user = await requireSession();
  const dashboards = dashboardsForRole(user.role);
  const { denied } = await searchParams;
  const deniedDash = denied ? findDashboard(denied) : null;

  return (
    <>
      <LandingHeader email={user.email} role={user.role} />
      <main className="landing-main">
        <section className="landing-hero">
          <h1>Dashboards</h1>
          <p>Selecciona un dashboard para abrirlo.</p>
        </section>

        {deniedDash && (
          <div className="denied-banner">
            No tenés permiso para ver <strong>{deniedDash.title}</strong>. Pedile acceso a un admin.
          </div>
        )}

        {dashboards.length === 0 ? (
          <div className="denied-banner">No tenés ningún dashboard asignado.</div>
        ) : (
          <div className="dash-grid">
            {dashboards.map((d) => (
              <DashboardCard key={d.slug} dashboard={d} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
