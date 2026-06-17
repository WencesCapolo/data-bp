export interface CrossSubdomainCookieConfig {
  enabled: boolean;
  domain?: string;
}

// Share the session cookie across *.basket-app.com so a login on the portal is
// recognized here. Disabled on localhost, where browsers reject parent-domain
// cookies. Mirrors the portal helper so both apps resolve the same domain.
export function resolveCrossSubdomainCookieConfig(baseUrl: string): CrossSubdomainCookieConfig {
  const host = new URL(baseUrl).hostname;
  const labels = host.split('.');
  if (labels.length < 2 || host.endsWith('.localhost')) {
    return { enabled: false };
  }
  const root = labels.slice(-2).join('.');
  return { enabled: true, domain: `.${root}` };
}
