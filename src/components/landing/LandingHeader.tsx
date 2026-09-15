'use client';
import { portalLogoutHref } from '@/lib/portal-links';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { HomeLink, BASE_DOMAIN_URL } from '@/components/ui/HomeLink';

interface Props {
  email: string;
  role: 'admin' | 'viewer';
  /** Where the arrow goes. Landing leaves to the base domain. */
  backHref?: string;
  backTitle?: string;
}

export function LandingHeader({ email, role, backHref = BASE_DOMAIN_URL, backTitle = 'Volver a basket-app.com' }: Props) {
  return (
    <header className="header">
      <div className="header-left">
        <a href="/" className="logo" aria-label="Basket.tv">
          <img src="/Basket.tv%20horizontal%20blanco.png" alt="Basket.tv" className="logo-img" />
          <span className="subtitle">Analytics</span>
        </a>
        <HomeLink href={backHref} title={backTitle} />
      </div>
      <div className="header-meta">
        <ThemeToggle />
        <span style={{ color: 'var(--text2)' }}>{email}</span>
        <span className="subtitle">{role}</span>
        <a href={portalLogoutHref()} className="btn-ghost" style={{ textDecoration: 'none' }}>
          salir
        </a>
      </div>
    </header>
  );
}
