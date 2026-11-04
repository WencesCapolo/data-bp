import { requireDashboard } from '@/lib/auth/rbac';
import { telemetry } from '@/lib/telemetry';
import { PartidosDashboard } from '@partidos/presentation/PartidosDashboard';

export const dynamic = 'force-dynamic';

export default async function PartidosPage() {
  const user = await requireDashboard('partidos');
  telemetry.trackServerEvent('dashboard_viewed', user.id, { dashboard: 'partidos' });
  return <PartidosDashboard />;
}
