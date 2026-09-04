'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * El "?" que acompaña a cada KPI, gráfico o insight y explica, en una frase,
 * qué mide. La burbuja se monta en `body` con un portal: varias tarjetas
 * recortan su contenido (`overflow: hidden`) y una burbuja absoluta dentro de
 * ellas se cortaría al borde.
 *
 * Se abre con el mouse encima y también con foco de teclado, y se cierra con
 * Escape, así que sirve igual para quien no usa mouse.
 */
export function InfoHint({ text, label = 'Qué significa' }: { text: ReactNode; label?: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const width = 280;
      const margin = 8;
      const below = r.bottom + 120 < window.innerHeight || r.top < 140;
      const left = Math.min(Math.max(margin, r.left + r.width / 2 - width / 2), window.innerWidth - width - margin);
      setPos({ top: below ? r.bottom + 6 : r.top - 6, left, below });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="info-hint"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        ?
      </button>
      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className={`info-hint-bubble ${pos.below ? 'below' : 'above'}`}
            style={{ top: pos.top, left: pos.left }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
