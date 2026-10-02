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
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        className={`input inline-flex max-w-60 min-w-28 items-center gap-1.5 py-1.5 pr-3 text-xs ${open ? 'border-accent' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{label}</span>
        {value.length > 0 && (
          <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">{value.length}</span>
        )}
        <span aria-hidden className="ml-auto text-[9px] text-n-400">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 max-h-80 min-w-52 overflow-y-auto rounded-[var(--panel-radius)] border border-[var(--border)] bg-surface p-2 shadow-[var(--shadow-lift)]">
          <div className="mb-1.5 flex gap-1 border-b border-[var(--border)] pb-2">
            <button type="button" className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-accent hover:bg-accent-soft" onClick={() => onChange([...options])}>
              Todos
            </button>
            <button type="button" className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-accent hover:bg-accent-soft" onClick={() => onChange([])}>
              Ninguno
            </button>
          </div>
          {options.map((o) => {
            const sel = value.includes(o);
            return (
              <label
                key={o}
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs select-none hover:bg-n-50 ${sel ? 'font-semibold text-accent-strong' : 'text-n-700'}`}
              >
                <input type="checkbox" className="accent-[var(--accent)]" checked={sel} onChange={() => toggle(o)} />
                {o}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
