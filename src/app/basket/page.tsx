import { requireDashboard } from '@/lib/auth/rbac';
import { SolicitudesDeAcceso } from '@/components/access-requests/SolicitudesDeAcceso';
import { BasketDashboard } from './BasketDashboard';

export const dynamic = 'force-dynamic';

export default async function BasketPage() {
  const user = await requireDashboard('basket-subs');
  return <BasketDashboard email={user.email} campana={<SolicitudesDeAcceso userId={user.id} />} />;
}
