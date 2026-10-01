import { describe, expect, it, vi } from 'vitest';

vi.mock('@shared/lib/mailer', () => ({ sendMail: vi.fn() }));

import { appUrlFromPortal } from '@/lib/access-requests/invite';

describe('appUrlFromPortal', () => {
  it('builds the app origin on the portal apex', () => {
    expect(appUrlFromPortal('https://portal.basket-app.com', 'analytics')).toBe('https://analytics.basket-app.com');
  });

  it('keeps the local port', () => {
    expect(appUrlFromPortal('http://portal.basket-app.localhost:3000', 'analytics')).toBe(
      'http://analytics.basket-app.localhost:3000',
    );
  });

  it('falls back to the portal off basket-app.com', () => {
    expect(appUrlFromPortal('http://localhost:3000', 'analytics')).toBe('http://localhost:3000');
  });
});
