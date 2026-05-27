import { requireDashboard } from '@/lib/auth/rbac';
import { PartidosDashboard } from '@partidos/presentation/PartidosDashboard';

export const dynamic = 'force-dynamic';

export default async function PartidosPage() {
  await requireDashboard('partidos');
  return <PartidosDashboard />;
}
