import type { ReactNode } from 'react';
import { requireSession } from '@/lib/auth/rbac';
import { lanzadorUrlFor } from '@/lib/auth/acceso-policy';
import { readEffectiveAppCount } from '@/lib/auth/reads';
import { authEnv } from '@/lib/env';
import { dashboardsForRole } from '@/lib/dashboards';
import { portalLogoutHref } from '@/lib/portal-links';
import { SolicitudesDeAcceso } from '@/components/access-requests/SolicitudesDeAcceso';
import { MarcoDeAnalytics } from '@/components/layout/MarcoDeAnalytics';

export const dynamic = 'force-dynamic';

// The shell of every page: who is signed in, which dashboards they see in the
// sidebar, the bell, and the way back to the launcher (two or more apps only).
// Each page still gates itself with requireSession / requireDashboard.
export default async function MarcoLayout({ children }: { children: ReactNode }) {
  const user = await requireSession();
  const lanzadorUrl = lanzadorUrlFor({ appCount: await readEffectiveAppCount(user.id), portalUrl: authEnv.portalUrl });

  return (
    <MarcoDeAnalytics
      nombre={user.name || user.email}
      rol={user.role}
      dashboards={dashboardsForRole(user.role).map(({ slug, title, href }) => ({ slug, title, href }))}
      lanzadorUrl={lanzadorUrl}
      logoutHref={portalLogoutHref()}
      campana={<SolicitudesDeAcceso userId={user.id} />}
    >
      {children}
    </MarcoDeAnalytics>
  );
}
