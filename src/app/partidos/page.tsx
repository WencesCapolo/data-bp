import { requireDashboard } from '@/lib/auth/rbac';
import { SolicitudesDeAcceso } from '@/components/access-requests/SolicitudesDeAcceso';
import { PartidosDashboard } from '@partidos/presentation/PartidosDashboard';

export const dynamic = 'force-dynamic';

export default async function PartidosPage() {
  const user = await requireDashboard('partidos');
  return <PartidosDashboard email={user.email} campana={<SolicitudesDeAcceso userId={user.id} />} />;
}
