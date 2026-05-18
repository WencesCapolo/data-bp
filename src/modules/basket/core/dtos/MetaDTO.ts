export interface MetaSyncEntry {
  source: string;
  lastSync: string;
  rowCount: number | null;
}

export interface MetaEnums {
  subTypes: readonly string[];
  accessTypes: readonly string[];
  platforms: readonly string[];
  granularity: readonly string[];
  ranges: readonly string[];
}

export interface MetaDTO {
  dataRange: { minDay: string; maxDay: string };
  countries: string[];
  lastSync: MetaSyncEntry[];
  enums: MetaEnums;
}

export const META_ENUMS: MetaEnums = {
  subTypes: ['Free', 'Mensual_Basico', 'Mensual_Total', 'Anual_Total', 'Otros'],
  accessTypes: ['real', 'voucher', 'antel'],
  platforms: ['MercadoPago', 'Manual', 'Voucher', 'PayPal', 'Stripe', 'Antel'],
  granularity: ['day', 'week', 'month'],
  ranges: ['30d', '90d', 'ytd', 'all', 'custom'],
};
