import { and, asc, desc, eq } from 'drizzle-orm';
import type { AuthDb } from '@shared/db/auth-client';
import { authAccessRequest, authAppAccess, authAppRole, authAuditLog, authEffectiveAccess } from '@/lib/auth/schema';
import type { CatalogRole, Decider } from './grant-rule';

// This app's side of the Solicitud de acceso lifecycle (portal ADR 0011). The
// portal owns the table and the form; this app lists its own pending rows and
// decides them, with the portal's rules:
//
// - First decision wins. The claim is a compare-and-set on status, scoped to
//   this app: the apex, the portal and this app may all race for one row, and
//   whoever loses is told it was already decided.
// - Approving grants exactly this app's role. Claim, Acceso and audit row
//   commit in one Auth DB transaction, so a Solicitud is never `aprobada`
//   without its role.
// - Rejecting is silent: an audit row, nothing to the applicant.

const PENDING = 'pendiente';

export type AccessRequestOutcome = 'aprobada' | 'rechazada';

export const ALREADY_RESOLVED_NOTICE = 'Esta solicitud ya fue resuelta.';

// A refusal meant for the decider, not a failure: the action shows its message.
export class AccessRequestRefusal extends Error {}

// A drizzle transaction exposes the same query builder as the client.
type AuthExecutor = Pick<AuthDb, 'select' | 'insert' | 'update'>;

export interface PendingAccessRequest {
  id: string;
  app: string;
  email: string;
  fullName: string;
  phone: string;
  ciudad: string | null;
  mensaje: string | null;
  createdAt: Date;
}

export interface ClaimedAccessRequest {
  id: string;
  email: string;
  userId: string;
}

export async function listPendingAccessRequests(exec: AuthExecutor, app: string): Promise<PendingAccessRequest[]> {
  return exec
    .select({
      id: authAccessRequest.id,
      app: authAccessRequest.app,
      email: authAccessRequest.email,
      fullName: authAccessRequest.fullName,
      phone: authAccessRequest.phone,
      ciudad: authAccessRequest.ciudad,
      mensaje: authAccessRequest.mensaje,
      createdAt: authAccessRequest.createdAt,
    })
    .from(authAccessRequest)
    .where(and(eq(authAccessRequest.app, app), eq(authAccessRequest.status, PENDING)))
    .orderBy(desc(authAccessRequest.createdAt));
}

export async function readDecider(exec: AuthExecutor, input: { userId: string; app: string }): Promise<Decider | null> {
  const rows = await exec
    .select({
      rank: authEffectiveAccess.rank,
      isAdmin: authEffectiveAccess.isAdmin,
      viaSuperadmin: authEffectiveAccess.viaSuperadmin,
    })
    .from(authEffectiveAccess)
    .where(and(eq(authEffectiveAccess.userId, input.userId), eq(authEffectiveAccess.app, input.app)))
    .limit(1);
  return rows[0] ?? null;
}

export async function readAppRoles(exec: AuthExecutor, app: string): Promise<CatalogRole[]> {
  return exec
    .select({ key: authAppRole.key, label: authAppRole.label, rank: authAppRole.rank })
    .from(authAppRole)
    .where(eq(authAppRole.app, app))
    .orderBy(asc(authAppRole.rank));
}

// Compare-and-set: the status predicate is what serializes two deciders
// clicking at once, not any read before it. Zero rows: someone else decided.
export async function claimAccessRequest(
  exec: AuthExecutor,
  input: { id: string; app: string; outcome: AccessRequestOutcome; deciderId: string; grantedRole?: string | null },
): Promise<ClaimedAccessRequest> {
  const claimed = await exec
    .update(authAccessRequest)
    .set({
      status: input.outcome,
      decidedAt: new Date(),
      decidedBy: input.deciderId,
      grantedRole: input.grantedRole ?? null,
    })
    .where(
      and(
        eq(authAccessRequest.id, input.id),
        eq(authAccessRequest.app, input.app),
        eq(authAccessRequest.status, PENDING),
      ),
    )
    .returning({ id: authAccessRequest.id, email: authAccessRequest.email, userId: authAccessRequest.userId });

  const row = claimed[0];
  if (!row) throw new AccessRequestRefusal(ALREADY_RESOLVED_NOTICE);
  return { id: row.id, email: row.email.trim().toLowerCase(), userId: row.userId };
}

export async function recordAccessRequestDecision(
  exec: AuthExecutor,
  input: {
    deciderId: string;
    claimed: ClaimedAccessRequest;
    app: string;
    outcome: AccessRequestOutcome;
    grantedRole?: string | null;
  },
): Promise<void> {
  await exec.insert(authAuditLog).values({
    actorId: input.deciderId,
    targetUserId: input.claimed.userId,
    action: `access-request.${input.outcome}`,
    detail: {
      requestId: input.claimed.id,
      app: input.app,
      email: input.claimed.email,
      grantedRole: input.grantedRole ?? null,
    },
  });
}

// The caller has already checked the decider and the rank rule.
export async function approveAccessRequest(
  db: AuthDb,
  input: { requestId: string; app: string; role: string; deciderId: string },
): Promise<ClaimedAccessRequest> {
  return db.transaction(async (tx) => {
    const claimed = await claimAccessRequest(tx, {
      id: input.requestId,
      app: input.app,
      outcome: 'aprobada',
      deciderId: input.deciderId,
      grantedRole: input.role,
    });

    const grantedAt = new Date();
    await tx
      .insert(authAppAccess)
      .values({ userId: claimed.userId, app: input.app, role: input.role, grantedBy: input.deciderId, grantedAt })
      .onConflictDoUpdate({
        target: [authAppAccess.userId, authAppAccess.app],
        set: { role: input.role, grantedBy: input.deciderId, grantedAt },
      });

    await recordAccessRequestDecision(tx, {
      deciderId: input.deciderId,
      claimed,
      app: input.app,
      outcome: 'aprobada',
      grantedRole: input.role,
    });

    return claimed;
  });
}

export async function rejectAccessRequest(
  db: AuthDb,
  input: { requestId: string; app: string; deciderId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const claimed = await claimAccessRequest(tx, {
      id: input.requestId,
      app: input.app,
      outcome: 'rechazada',
      deciderId: input.deciderId,
    });
    await recordAccessRequestDecision(tx, { deciderId: input.deciderId, claimed, app: input.app, outcome: 'rechazada' });
  });
}
