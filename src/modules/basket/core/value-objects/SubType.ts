export type SubType =
  | 'Free'
  | 'Mensual_Basico'
  | 'Mensual_Total'
  | 'Anual_Total'
  | 'Otros';

export function classifySubType(recurrent: number, priceId: number | null): SubType {
  if (recurrent === 0) return 'Free';
  if (recurrent === 30 && priceId === 100010) return 'Mensual_Basico';
  if (recurrent === 30 && (priceId === 100030 || priceId === 100011)) return 'Mensual_Total';
  if (recurrent === 365) return 'Anual_Total';
  return 'Otros';
}
