'use client';
import type { ReactNode } from 'react';
import { portalLogoutHref } from '@/lib/portal-links';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { HomeLink } from '@/components/ui/HomeLink';

interface Props {
  email: string;
  role: 'admin' | 'viewer';
  /** The apex directory, or null for someone with fewer than two apps: then
   *  there is nothing to go back to and the arrow is hidden. */
  lanzadorUrl: string | null;
  /** The Solicitudes bell, for analytics admins and super admins. */
  campana?: ReactNode;
}

export function LandingHeader({ email, role, lanzadorUrl, campana }: Props) {
  return (
    <header className="header">
      <div className="header-left">
        <a href="/" className="logo" aria-label="Basket.tv">
          <img src="/Basket.tv%20horizontal%20blanco.png" alt="Basket.tv" className="logo-img" />
          <span className="subtitle">Analytics</span>
        </a>
        {lanzadorUrl && <HomeLink href={lanzadorUrl} title="Volver a basket-app.com" />}
      </div>
      <div className="header-meta">
        {campana}
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
