import { portalLoginUrl } from './acceso-policy';

export type ProxyDecision = { kind: 'redirect'; to: string } | { kind: 'unauthorized' };

// Proxy decision: cookie presence only, no DB (the pages read the session and
// the Acceso). A page without cookie goes to the portal login with the exact
// URL asked for, so a deep link comes back to the same page after login. An
// API call without cookie gets 401 JSON: a fetch cannot follow a login page.
export function resolveProxyRedirect(input: {
  hasSessionCookie: boolean;
  requestUrl: string;
  portalUrl: string;
}): ProxyDecision | null {
  if (input.hasSessionCookie) return null;
  if (new URL(input.requestUrl).pathname.startsWith('/api/')) return { kind: 'unauthorized' };
  return { kind: 'redirect', to: portalLoginUrl(input.portalUrl, input.requestUrl) };
}

// Behind nginx, `next start` reports request.url on its own listen address
// (http://localhost:3001). The URL the browser asked for comes from the Host
// header nginx forwards, the same way the portal builds its apex URL. The
// scheme can't come from X-Forwarded-Proto: Next fills it with its own "http"
// when nginx doesn't send one.
export function publicRequestUrl(input: { requestUrl: string; host: string | null }): string {
  const url = new URL(input.requestUrl);
  if (!input.host) return url.toString();
  const proto = input.host.startsWith('localhost') ? 'http' : 'https';
  return `${proto}://${input.host}${url.pathname}${url.search}`;
}
