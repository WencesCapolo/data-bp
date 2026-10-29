import { requireDashboard } from '@/lib/auth/rbac';
import { trackServerEvent } from '@/lib/telemetry';
import { BasketDashboard } from './BasketDashboard';

export const dynamic = 'force-dynamic';

export default async function BasketPage() {
  const user = await requireDashboard('basket-subs');
  trackServerEvent('dashboard_viewed', user.id, { dashboard: 'basket-subs' });
  return <BasketDashboard />;
}
