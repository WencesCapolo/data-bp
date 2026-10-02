import { requireDashboard } from '@/lib/auth/rbac';
import { FinancieroDashboard } from './FinancieroDashboard';

export const dynamic = 'force-dynamic';

export default async function FinancieroPage() {
  await requireDashboard('financiero');
  return <FinancieroDashboard />;
}
