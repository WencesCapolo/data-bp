'use client';
import type { AccessType } from '@basket/core/dtos/shared';
import { PillGroup } from './PillGroup';

const OPTS: { val: AccessType | undefined; label: string }[] = [
  { val: undefined, label: 'Todos' },
  { val: 'real', label: 'Real' },
  { val: 'voucher', label: 'Voucher' },
  { val: 'antel', label: 'Antel' },
];

export function AccessPills({ value, onChange }: { value?: AccessType; onChange: (v?: AccessType) => void }) {
  return <PillGroup options={OPTS} value={value} onChange={onChange} label="Acceso" />;
}
