'use client';
import { useState } from 'react';
import { signIn } from '@/lib/auth/client';

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onGoogle() {
    setError(null);
    setLoading(true);
    const res = await signIn.social({ provider: 'google', callbackURL: '/basket' });
    if (res?.error) {
      setError(res.error.message ?? 'Sign-in failed.');
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ width: '100%', maxWidth: 360, padding: 32, textAlign: 'center' }}>
        <div className="logo" style={{ justifyContent: 'center', marginBottom: 16, flexDirection: 'column', gap: 8 }}>
          <img src="/Basket.tv%20horizontal%20blanco.png" alt="Basket.tv" className="logo-img" style={{ height: 40 }} />
          <span className="subtitle">Analytics</span>
        </div>
        <p style={{ color: 'var(--text3)', marginBottom: 24, fontSize: 13 }}>
          Sign in with your <strong>@basquetpass.tv</strong> Google account.
        </p>
        <button onClick={onGoogle} disabled={loading} className="btn-primary" style={{ width: '100%' }}>
          {loading ? 'Redirecting…' : 'Continue with Google'}
        </button>
        {error && (
          <p style={{ marginTop: 16, color: 'var(--red)', fontFamily: 'DM Mono, monospace', fontSize: 12 }}>
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
