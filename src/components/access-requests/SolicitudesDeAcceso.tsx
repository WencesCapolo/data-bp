import type { SolicitudPendiente } from 'basket-tv-ui';
import { authDb } from '@shared/db/auth-client';
import { approveAccessRequestAction, rejectAccessRequestAction } from '@/app/actions/access-requests';
import { ANALYTICS_APP } from '@/lib/auth/acceso-policy';
import { canDecide, grantableRoles } from '@/lib/access-requests/grant-rule';
import { listPendingAccessRequests, readAppRoles, readDecider } from '@/lib/access-requests/requests';
import { SolicitudesBell } from './SolicitudesBell';

// Server half of the header bell: shown only to analytics admins and super
// admins, listing analytics Solicitudes only, with the roles the viewer may
// grant. A failing Auth DB read hides the bell rather than the dashboard.
async function loadBell(userId: string): Promise<SolicitudPendiente[] | null> {
  try {
    const decider = await readDecider(authDb, { userId, app: ANALYTICS_APP });
    if (!canDecide(decider)) return null;

    const [pending, roles] = await Promise.all([
      listPendingAccessRequests(authDb, ANALYTICS_APP),
      readAppRoles(authDb, ANALYTICS_APP),
    ]);
    const offered = grantableRoles(decider, roles).map((role) => ({ valor: role.key, etiqueta: role.label }));

    return pending.map((request) => ({
      id: request.id,
      app: request.app,
      nombreDeApp: 'Analytics',
      nombre: request.fullName,
      email: request.email,
      telefono: request.phone,
      ciudad: request.ciudad,
      mensaje: request.mensaje,
      roles: offered,
    }));
  } catch (error) {
    console.error('[access-requests] failed to load the bell', error);
    return null;
  }
}

export async function SolicitudesDeAcceso({ userId }: { userId: string }) {
  const solicitudes = await loadBell(userId);
  if (!solicitudes) return null;
  return (
    <SolicitudesBell
      solicitudes={solicitudes}
      aprobar={approveAccessRequestAction}
      rechazar={rejectAccessRequestAction}
    />
  );
}
