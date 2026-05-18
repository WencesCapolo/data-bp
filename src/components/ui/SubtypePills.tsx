'use client';
import type { SubType } from '@basket/core/dtos/shared';

const OPTS: { val: SubType | undefined; label: string }[] = [
  { val: undefined, label: 'Todos' },
  { val: 'Free', label: 'Free' },
  { val: 'Mensual_Basico', label: 'Mens. Básico' },
  { val: 'Mensual_Total', label: 'Mens. Total' },
  { val: 'Anual_Total', label: 'Anual' },
  { val: 'Otros', label: 'Otros' },
];

export function SubtypePills({
  value,
  onChange,
}: {
  value?: SubType;
  onChange: (v?: SubType) => void;
}) {
  return (
    <div className="date-pills">
      {OPTS.map((o) => (
        <button
          key={o.label}
          type="button"
          className={`date-pill ${value === o.val ? 'active' : ''}`}
          onClick={() => onChange(o.val)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
