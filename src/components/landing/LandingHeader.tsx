'use client';
import { signOut } from '@/lib/auth/client';
import { swapToPortal, buildPortalLoginUrl } from '@/lib/auth/portal';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { HomeLink, BASE_DOMAIN_URL } from '@/components/ui/HomeLink';

interface Props {
  email: string;
  role: 'admin' | 'viewer';
  /** Where the arrow goes. Landing leaves to the base domain; admin returns to landing. */
  backHref?: string;
  backTitle?: string;
}

export function LandingHeader({ email, role, backHref = BASE_DOMAIN_URL, backTitle = 'Volver a basket-app.com' }: Props) {
  return (
    <header className="header">
      <a href="/" className="logo" aria-label="Basket.tv">
        <img src="/Basket.tv%20horizontal%20blanco.png" alt="Basket.tv" className="logo-img" />
        <span className="subtitle">Analytics</span>
      </a>
      <div className="header-meta">
        <HomeLink href={backHref} title={backTitle} />
        <ThemeToggle />
        <span style={{ color: 'var(--text2)' }}>{email}</span>
        <span className="subtitle">{role}</span>
        {role === 'admin' && (
          <a href="/admin" className="btn-ghost" style={{ textDecoration: 'none' }}>
            admin
          </a>
        )}
        <button
          type="button"
          onClick={() =>
            signOut({
              fetchOptions: {
                onSuccess: () => {
                  window.location.href = buildPortalLoginUrl(swapToPortal(window.location.origin));
                },
              },
            })
          }
          className="btn-ghost"
        >
          salir
        </button>
      </div>
    </header>
  );
}
