import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@shared/db/client';
import { authAllowedEmails } from '@/lib/auth/schema';
import { requireRole } from '@/lib/auth/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_DOMAIN = '@basquetpass.tv';

const RoleSchema = z.enum(['admin', 'viewer']);
const CreateSchema = z.object({
  email: z.string().email().toLowerCase(),
  role: RoleSchema,
  note: z.string().nullish(),
});
const PatchSchema = z.object({
  email: z.string().email().toLowerCase(),
  role: RoleSchema,
});

function badDomain(email: string): NextResponse | null {
  if (!email.endsWith(ALLOWED_DOMAIN)) {
    return NextResponse.json({ error: `email must end with ${ALLOWED_DOMAIN}` }, { status: 400 });
  }
  return null;
}

export async function GET(): Promise<NextResponse> {
  await requireRole('admin');
  const rows = await db
    .select({
      email: authAllowedEmails.email,
      role: authAllowedEmails.role,
      note: authAllowedEmails.note,
    })
    .from(authAllowedEmails);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  await requireRole('admin');
  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const { email, role, note } = parsed.data;
  const dom = badDomain(email);
  if (dom) return dom;
  await db
    .insert(authAllowedEmails)
    .values({ email, role, note: note ?? null })
    .onConflictDoUpdate({
      target: authAllowedEmails.email,
      set: { role, note: note ?? null },
    });
  // Role is resolved per-app from the allowlist at read time; the shared,
  // portal-owned authUser.role is never written from here.
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const current = await requireRole('admin');
  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { email, role } = parsed.data;
  if (email === current.email && role !== 'admin') {
    return NextResponse.json({ error: 'cannot demote yourself' }, { status: 400 });
  }
  await db.update(authAllowedEmails).set({ role }).where(eq(authAllowedEmails.email, email));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const current = await requireRole('admin');
  const email = req.nextUrl.searchParams.get('email')?.toLowerCase();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  if (email === current.email) return NextResponse.json({ error: 'cannot remove yourself' }, { status: 400 });
  // Removing from this app's allowlist revokes analytics access on the next
  // request (read-time gate in getSessionUser). The shared identity/session in
  // basket_auth is left intact so the user stays logged in to sibling apps.
  await db.delete(authAllowedEmails).where(eq(authAllowedEmails.email, email));
  return NextResponse.json({ ok: true });
}
