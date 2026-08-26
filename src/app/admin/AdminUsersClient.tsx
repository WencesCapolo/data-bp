'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminRow } from './page';

interface Props {
  initialRows: AdminRow[];
  currentEmail: string;
}

export function AdminUsersClient({ initialRows, currentEmail }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'viewer'>('viewer');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), role, note: note.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setEmail('');
      setNote('');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(target: string, next: 'admin' | 'viewer') {
    setBusy(true);
    setErr(null);
    const prev = rows;
    setRows(rows.map((r) => (r.email === target ? { ...r, role: next } : r)));
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: target, role: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setRows(prev);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: string) {
    if (!confirm(`Quitar acceso a ${target}?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/users?email=${encodeURIComponent(target)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <form className="admin-form" onSubmit={add}>
        <input
          type="email"
          placeholder="email@basquetpass.tv"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={busy}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'viewer')} disabled={busy}>
          <option value="viewer">viewer</option>
          <option value="admin">admin</option>
        </select>
        <input
          type="text"
          placeholder="nota (opcional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
          style={{ flex: 1, minWidth: 160 }}
        />
        <button type="submit" className="btn-primary" disabled={busy || !email}>
          {busy ? '…' : 'Agregar'}
        </button>
      </form>

      {err && (
        <div className="denied-banner" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}

      <div className="table-wrap" style={{ border: 'none', background: 'transparent' }}>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Rol</th>
            <th>Estado</th>
            <th>Nota</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.email}>
              <td style={{ fontFamily: 'DM Mono, monospace' }}>{r.email}</td>
              <td>
                <select
                  value={r.role}
                  onChange={(e) => changeRole(r.email, e.target.value as 'admin' | 'viewer')}
                  disabled={busy || r.email === currentEmail}
                >
                  <option value="viewer">viewer</option>
                  <option value="admin">admin</option>
                </select>
              </td>
              <td style={{ color: r.signedIn ? 'var(--green)' : 'var(--text3)' }}>
                {r.signedIn ? 'activo' : 'pendiente'}
              </td>
              <td style={{ color: 'var(--text3)' }}>{r.note ?? ''}</td>
              <td style={{ textAlign: 'right' }}>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => remove(r.email)}
                  disabled={busy || r.email === currentEmail}
                >
                  quitar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
