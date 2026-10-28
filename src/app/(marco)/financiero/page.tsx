import { requireDashboard } from '@/lib/auth/rbac';
import { trackServerEvent } from '@/lib/telemetry';
import { FinancieroDashboard } from './FinancieroDashboard';

export const dynamic = 'force-dynamic';

export default async function FinancieroPage() {
  const user = await requireDashboard('financiero');
  trackServerEvent('dashboard_viewed', user.id, { dashboard: 'financiero' });
  return <FinancieroDashboard />;
}
