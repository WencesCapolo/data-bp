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

  return (
    <div ref={ref} className={`multiselect ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="multiselect-btn"
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        {value.length > 0 && <span className="multiselect-count">{value.length}</span>}
      </button>
      {open && (
        <div className="multiselect-dropdown">
          <div className="multiselect-actions">
            <button type="button" className="multiselect-action" onClick={() => onChange([...options])}>
              Todos
            </button>
            <button type="button" className="multiselect-action" onClick={() => onChange([])}>
              Ninguno
            </button>
          </div>
          {options.map((o) => {
            const sel = value.includes(o);
            return (
              <label key={o} className={`multiselect-option ${sel ? 'selected' : ''}`}>
                <input type="checkbox" checked={sel} onChange={() => toggle(o)} />
                {o}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
