'use client';
// PROTOTYPE — variant switcher for the teams-daily question:
// "¿cómo mostramos la variación de suscripciones por día por equipo, y el total
//  de seguidores por equipo?" Three variants on the existing /basket?tab=teams
// route, switchable with ?variant=A|B|C. Delete once one wins.
import { useEffect, useState } from 'react';
import { PrototypeSwitcher } from '@/components/prototype/PrototypeSwitcher';
import { VariantA } from './VariantA';
import { VariantB } from './VariantB';
import { VariantC } from './VariantC';

const VARIANTS = [
  { key: 'A', name: 'Grilla equipos × días' },
  { key: 'B', name: 'Ficha de equipo' },
  { key: 'C', name: 'Diario de movimientos' },
];

export function TeamsDailyPrototype() {
  const [variant, setVariant] = useState('A');

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('variant');
    if (v && VARIANTS.some((x) => x.key === v)) setVariant(v);
  }, []);

  function change(key: string) {
    setVariant(key);
    const p = new URLSearchParams(window.location.search);
    p.set('variant', key);
    window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`);
  }

  return (
    <>
      {variant === 'A' && <VariantA />}
      {variant === 'B' && <VariantB />}
      {variant === 'C' && <VariantC />}
      <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={change} />
    </>
  );
}

export { VARIANTS as PROTOTYPE_VARIANTS };
