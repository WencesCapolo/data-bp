export type DateRange =
  | { kind: '30d' | '90d' | 'ytd' | 'all' }
  | { kind: 'custom'; from: string; to: string };

export interface CountryFilter {
  countries?: string[];
}

export interface AccessTypeFilter {
  accessType?: 'real' | 'voucher' | 'antel' | 'all';
}

export type Granularity = 'day' | 'week' | 'month';
