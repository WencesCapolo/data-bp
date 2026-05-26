import { requireDashboard } from '@/lib/auth/rbac';
import { BasketDashboard } from './BasketDashboard';

export const dynamic = 'force-dynamic';

export default async function BasketPage() {
  await requireDashboard('basket-subs');
  return <BasketDashboard />;
}
