'use client';
import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}

export function MultiSelect({ label, options, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function toggle(o: string) {
    if (value.includes(o)) onChange(value.filter((v) => v !== o));
    else onChange([...value, o]);
  }

  const summary = value.length === 0 ? label : `${label}: ${value.length}`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className={`date-pill ${value.length > 0 ? 'active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        {summary} ▾
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 50,
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 6,
            minWidth: 180,
            maxHeight: 260,
            overflowY: 'auto',
            boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
          }}
        >
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              style={{
                width: '100%',
                padding: '6px 10px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text3)',
                fontSize: 11,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              Limpiar
            </button>
          )}
          {options.map((o) => (
            <label
              key={o}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                fontSize: 12,
                color: 'var(--text2)',
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              <input
                type="checkbox"
                checked={value.includes(o)}
                onChange={() => toggle(o)}
                style={{ accentColor: 'var(--accent)' }}
              />
              {o}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
