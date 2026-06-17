// SSO single login point: analytics has no sign-in page of its own. Unauthenticated
// users are sent to the portal's /login, which (once authenticated against the shared
// basket_auth identity) bounces them back via ?redirectTo. Portal's open-redirect guard
// only honors *.basket-app.com targets, so the analytics URL survives.

// Swap the leftmost host label to "portal" (analytics.basket-app.com -> portal.basket-app.com).
// Left unchanged on localhost, where there's no subdomain to swap.
export function swapToPortal(base: string): string {
  try {
    const url = new URL(base);
    if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
      return base.replace(/\/$/, '');
    }
    const labels = url.hostname.split('.');
    labels[0] = 'portal';
    return `${url.protocol}//${labels.join('.')}`;
  } catch {
    return base.replace(/\/$/, '');
  }
}

export function buildPortalLoginUrl(portalBase: string, redirectTo?: string): string {
  const login = `${portalBase.replace(/\/$/, '')}/login`;
  return redirectTo ? `${login}?redirectTo=${encodeURIComponent(redirectTo)}` : login;
}

// Server/edge convenience: resolve the portal login URL from env. `PORTAL_BASE_URL`
// overrides the derived host (useful in dev where there's no portal subdomain).
export function resolvePortalLoginUrl(redirectTo?: string): string {
  const analyticsBase = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const portalBase = process.env.PORTAL_BASE_URL ?? swapToPortal(analyticsBase);
  return buildPortalLoginUrl(portalBase, redirectTo ?? analyticsBase);
}
