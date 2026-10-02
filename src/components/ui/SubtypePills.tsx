'use client';
import type { SubType } from '@basket/core/dtos/shared';
import { PillGroup } from './PillGroup';

const OPTS: { val: SubType | undefined; label: string }[] = [
  { val: undefined, label: 'Todos' },
  { val: 'Free', label: 'Free' },
  { val: 'Mensual_Basico', label: 'Mens. Básico' },
  { val: 'Mensual_Total', label: 'Mens. Total' },
  { val: 'Anual_Total', label: 'Anual' },
  { val: 'Otros', label: 'Otros' },
];

export function SubtypePills({ value, onChange }: { value?: SubType; onChange: (v?: SubType) => void }) {
  return <PillGroup options={OPTS} value={value} onChange={onChange} label="Subtipo" />;
}
