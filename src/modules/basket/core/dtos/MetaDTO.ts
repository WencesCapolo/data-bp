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
  enums: MetaEnums;
}

export const META_ENUMS: MetaEnums = {
  subTypes: ['Free', 'Mensual_Basico', 'Mensual_Total', 'Anual_Total', 'Otros'],
  accessTypes: ['real', 'voucher', 'antel'],
  platforms: ['MercadoPago', 'Manual', 'Voucher', 'PayPal', 'Stripe', 'Antel'],
  granularity: ['day', 'week', 'month'],
  ranges: ['yesterday', '7d', '30d', '90d', 'ytd', 'all', 'custom'],
};
