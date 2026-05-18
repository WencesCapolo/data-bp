'use client';
import type { AccessType } from '@basket/core/dtos/shared';

const OPTS: { val: AccessType | undefined; label: string }[] = [
  { val: undefined, label: 'Todos' },
  { val: 'real', label: 'Real' },
  { val: 'voucher', label: 'Voucher' },
  { val: 'antel', label: 'Antel' },
];

export function AccessPills({
  value,
  onChange,
}: {
  value?: AccessType;
  onChange: (v?: AccessType) => void;
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
