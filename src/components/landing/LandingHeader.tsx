'use client';
import { signOut } from '@/lib/auth/client';

interface Props {
  email: string;
  role: 'admin' | 'viewer';
}

export function LandingHeader({ email, role }: Props) {
  return (
    <header className="header">
      <a href="/" className="logo" aria-label="Basket.tv">
        <img src="/Basket.tv%20horizontal%20blanco.png" alt="Basket.tv" className="logo-img" />
        <span className="subtitle">Analytics</span>
      </a>
      <div className="header-meta">
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
                  window.location.href = '/sign-in';
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
