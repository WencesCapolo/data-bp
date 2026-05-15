export type SubType =
  | 'Free'
  | 'Mensual_Basico'
  | 'Mensual_Total'
  | 'Anual_Total'
  | 'Otros';

const SUB_TYPE_LABELS: Record<SubType, string> = {
  Free: 'Gratis',
  Mensual_Basico: 'Mensual Básico',
  Mensual_Total: 'Mensual Total',
  Anual_Total: 'Anual Total',
  Otros: 'Otros',
};

export function classifySubType(recurrent: number, priceId: number | null): SubType {
  if (recurrent === 0) return 'Free';
  if (recurrent === 30 && priceId === 100010) return 'Mensual_Basico';
  if (recurrent === 30 && (priceId === 100030 || priceId === 100011)) return 'Mensual_Total';
  if (recurrent === 365) return 'Anual_Total';
  return 'Otros';
}

export function isRecurring(subType: SubType): boolean {
  return subType === 'Mensual_Basico' || subType === 'Mensual_Total' || subType === 'Anual_Total';
}

export function subTypeLabel(subType: SubType): string {
  return SUB_TYPE_LABELS[subType];
}
