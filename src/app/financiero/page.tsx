import { requireDashboard } from '@/lib/auth/rbac';
import { FinancieroDashboard } from './FinancieroDashboard';

export const dynamic = 'force-dynamic';

export default async function FinancieroPage() {
  const user = await requireDashboard('financiero');
  return <FinancieroDashboard email={user.email} />;
}
