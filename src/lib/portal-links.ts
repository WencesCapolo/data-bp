// Client-safe portal URLs. The portal is the only Auth server: it owns the
// login page and ends the shared session everywhere on /logout.
import { authEnv } from '@/lib/env';

export function portalLogoutHref(): string {
  return `${authEnv.portalUrl}/logout`;
}
