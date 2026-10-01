import { urlDelLanzador } from 'basket-tv-ui';
import { sendMail } from '@shared/lib/mailer';

// Hosts stay in config (portal ADR 0010): this app's origin is the portal's
// apex with the app's subdomain. Off basket-app.com there is no apex, and the
// portal is the only place left to send someone.
export function appUrlFromPortal(portalUrl: string, subdomain: string): string {
  const apex = urlDelLanzador(portalUrl);
  if (!apex) return portalUrl;
  const url = new URL(apex);
  url.hostname = `${subdomain}.${url.hostname}`;
  return url.origin;
}

// Same wording as the portal's invite, linking to this app instead of the
// portal login.
export async function sendAccessInviteEmail(input: { to: string; appName: string; appUrl: string }): Promise<void> {
  await sendMail({
    to: input.to,
    subject: `Tienes acceso a ${input.appName}`,
    text: `Se habilitó tu acceso a ${input.appName}.\n\nIngresa desde:\n${input.appUrl}\n\nUsa tu correo para recibir un enlace de acceso, o inicia sesión con Google si tu cuenta lo permite.`,
  });
}
