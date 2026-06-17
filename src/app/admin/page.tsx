import { requireRole } from '@/lib/auth/rbac';
import { db } from '@shared/db/client';
import { authDb } from '@shared/db/auth-client';
import { authAllowedEmails, authUser } from '@/lib/auth/schema';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { AdminUsersClient } from './AdminUsersClient';

export const dynamic = 'force-dynamic';

interface Row {
  email: string;
  role: 'admin' | 'viewer';
  note: string | null;
  signedIn: boolean;
}

async function loadRows(): Promise<Row[]> {
  const allowed = await db
    .select({ email: authAllowedEmails.email, role: authAllowedEmails.role, note: authAllowedEmails.note })
    .from(authAllowedEmails);
  const users = await authDb.select({ email: authUser.email }).from(authUser);
  const signed = new Set(users.map((u) => u.email.toLowerCase()));
  return allowed
    .map((r) => ({
      email: r.email,
      role: (r.role === 'admin' ? 'admin' : 'viewer') as 'admin' | 'viewer',
      note: r.note,
      signedIn: signed.has(r.email.toLowerCase()),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export default async function AdminPage() {
  const user = await requireRole('admin');
  const rows = await loadRows();
  return (
    <>
      <LandingHeader email={user.email} role={user.role} />
      <main className="landing-main">
        <section className="landing-hero">
          <h1>Admin · Usuarios</h1>
          <p>Gestioná la lista de emails autorizados y sus roles.</p>
        </section>
        <AdminUsersClient initialRows={rows} currentEmail={user.email} />
      </main>
    </>
  );
}

export type { Row as AdminRow };
