'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authDb } from '@shared/db/auth-client';
import { ANALYTICS_APP } from '@/lib/auth/acceso-policy';
import { readSession } from '@/lib/auth/reads';
import { authEnv } from '@/lib/env';
import { canDecide, canGrantRole } from '@/lib/access-requests/grant-rule';
import { appUrlFromPortal, sendAccessInviteEmail } from '@/lib/access-requests/invite';
import {
  AccessRequestRefusal,
  approveAccessRequest,
  readAppRoles,
  readDecider,
  rejectAccessRequest,
} from '@/lib/access-requests/requests';

// The bell's two decisions (CampanaDeSolicitudes posts solicitudId, app and,
// to approve, rol). The component authorizes nothing: every action reads the
// session, checks the decider is this app's admin or a super admin, and
// re-checks the rank rule before claiming.

export interface DecisionResult {
  intent: 'ok' | 'error';
  notice: string;
}

const APP_NAME = 'Analytics';

const decisionSchema = z.object({
  solicitudId: z.string().uuid(),
  app: z.literal(ANALYTICS_APP),
  rol: z.string().trim().optional(),
});

function readDecision(formData: FormData) {
  return decisionSchema.safeParse({
    solicitudId: String(formData.get('solicitudId') ?? ''),
    app: String(formData.get('app') ?? ''),
    rol: String(formData.get('rol') ?? ''),
  });
}

async function authorizedDecider() {
  const session = await readSession();
  if (!session) return null;
  const decider = await readDecider(authDb, { userId: session.id, app: ANALYTICS_APP });
  return canDecide(decider) ? { userId: session.id, decider } : null;
}

const DENIED: DecisionResult = { intent: 'error', notice: 'No tenés permisos para decidir solicitudes de Analytics.' };
const INVALID: DecisionResult = { intent: 'error', notice: 'La solicitud no es válida.' };
const FAILED: DecisionResult = { intent: 'error', notice: 'No pudimos guardar la decisión. Probá de nuevo.' };

export async function approveAccessRequestAction(formData: FormData): Promise<DecisionResult> {
  try {
    const actor = await authorizedDecider();
    if (!actor) return DENIED;
    const parsed = readDecision(formData);
    if (!parsed.success) return INVALID;
    const { solicitudId, rol } = parsed.data;
    if (!rol) return { intent: 'error', notice: 'Elegí un rol.' };

    const role = (await readAppRoles(authDb, ANALYTICS_APP)).find((r) => r.key === rol);
    if (!role) return { intent: 'error', notice: 'Ese rol no existe en Analytics.' };
    if (!canGrantRole(actor.decider, role)) return { intent: 'error', notice: 'No podés otorgar ese rol.' };

    const claimed = await approveAccessRequest(authDb, {
      requestId: solicitudId,
      app: ANALYTICS_APP,
      role: role.key,
      deciderId: actor.userId,
    });
    revalidatePath('/', 'layout');

    // The approval is committed: a failing invite must not undo it.
    let emailNotice = '';
    try {
      await sendAccessInviteEmail({
        to: claimed.email,
        appName: APP_NAME,
        appUrl: appUrlFromPortal(authEnv.portalUrl, ANALYTICS_APP),
      });
    } catch (error) {
      console.error('[access-requests] invite email failed', error);
      emailNotice = ' No pudimos enviarle el correo de aviso.';
    }

    return { intent: 'ok', notice: `Solicitud aprobada: ${claimed.email} es ${role.label} en ${APP_NAME}.${emailNotice}` };
  } catch (error) {
    if (error instanceof AccessRequestRefusal) {
      // Someone else decided it: refresh so the bell drops the stale item.
      revalidatePath('/', 'layout');
      return { intent: 'error', notice: error.message };
    }
    console.error('[access-requests] approval failed', error);
    return FAILED;
  }
}

export async function rejectAccessRequestAction(formData: FormData): Promise<DecisionResult> {
  try {
    const actor = await authorizedDecider();
    if (!actor) return DENIED;
    const parsed = readDecision(formData);
    if (!parsed.success) return INVALID;

    await rejectAccessRequest(authDb, { requestId: parsed.data.solicitudId, app: ANALYTICS_APP, deciderId: actor.userId });
    revalidatePath('/', 'layout');
    return { intent: 'ok', notice: 'Solicitud rechazada.' };
  } catch (error) {
    if (error instanceof AccessRequestRefusal) {
      revalidatePath('/', 'layout');
      return { intent: 'error', notice: error.message };
    }
    console.error('[access-requests] rejection failed', error);
    return FAILED;
  }
}
