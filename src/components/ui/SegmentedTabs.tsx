'use client';
import type { ReactNode } from 'react';

/** A dashboard's in-page views (not routes): Visión General, Evolución… */
export function SegmentedTabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly { key: K; label: string; icon?: ReactNode }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          className="segment"
          onClick={() => onChange(t.key)}
        >
          {t.icon && <span aria-hidden>{t.icon}</span>}
          {t.label}
        </button>
      ))}
    </div>
  );
}
