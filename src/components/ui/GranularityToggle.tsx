'use client';
import type { Granularity } from '@basket/core/dtos/shared';
import { PillGroup } from './PillGroup';

const OPTS: { val: Granularity; label: string }[] = [
  { val: 'day', label: 'Día' },
  { val: 'week', label: 'Semana' },
  { val: 'month', label: 'Mes' },
];

export function GranularityToggle({ value, onChange }: { value: Granularity; onChange: (v: Granularity) => void }) {
  return <PillGroup options={OPTS} value={value} onChange={onChange} label="Granularidad" />;
}
