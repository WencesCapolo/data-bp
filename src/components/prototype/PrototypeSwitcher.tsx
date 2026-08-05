'use client';
// PROTOTYPE — floating variant switcher. Delete when a variant wins.
import { useEffect } from 'react';

interface Props {
  variants: { key: string; name: string }[];
  current: string;
  onChange: (key: string) => void;
}

export function PrototypeSwitcher({ variants, current, onChange }: Props) {
  const i = Math.max(0, variants.findIndex((v) => v.key === current));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      const tag = el?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement | null)?.isContentEditable) return;
      if (e.key === 'ArrowLeft') onChange(variants[(i - 1 + variants.length) % variants.length].key);
      if (e.key === 'ArrowRight') onChange(variants[(i + 1) % variants.length].key);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, variants, onChange]);

  if (process.env.NODE_ENV === 'production') return null;

  const btn: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: '#0a0e1a',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    padding: '0 10px',
    lineHeight: 1,
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: '#fbbf24',
        color: '#0a0e1a',
        borderRadius: 999,
        padding: '8px 10px',
        boxShadow: '0 8px 28px rgba(0,0,0,.55)',
        fontSize: 12,
        fontFamily: "'DM Mono', monospace",
      }}
    >
      <button style={btn} onClick={() => onChange(variants[(i - 1 + variants.length) % variants.length].key)}>
        ←
      </button>
      <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
        PROTOTYPE {variants[i].key} — {variants[i].name}
      </span>
      <button style={btn} onClick={() => onChange(variants[(i + 1) % variants.length].key)}>
        →
      </button>
    </div>
  );
}
