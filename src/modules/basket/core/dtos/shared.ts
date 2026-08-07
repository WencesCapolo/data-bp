export type DateRange =
  | { kind: 'yesterday' | '7d' | '30d' | '90d' | 'ytd' | 'all' }
  | { kind: 'custom'; from: string; to: string };

export type AccessType = 'real' | 'voucher' | 'antel';
export type SubType =
  | 'Free'
  | 'Mensual_Basico'
  | 'Mensual_Total'
  | 'Anual_Total'
  | 'Otros';

export interface CommonFilters {
  countries?: string[];
  accessType?: AccessType;
  subType?: SubType;
}

export type Granularity = 'day' | 'week' | 'month';

export function hasFilters(f?: CommonFilters): boolean {
  if (!f) return false;
  return Boolean((f.countries && f.countries.length > 0) || f.accessType || f.subType);
}
