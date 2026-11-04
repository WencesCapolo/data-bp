import { requireDashboard } from '@/lib/auth/rbac';
import { telemetry } from '@/lib/telemetry';
import { FinancieroDashboard } from './FinancieroDashboard';

export const dynamic = 'force-dynamic';

export default async function FinancieroPage() {
  const user = await requireDashboard('financiero');
  telemetry.trackServerEvent('dashboard_viewed', user.id, { dashboard: 'financiero' });
  return <FinancieroDashboard />;
}
