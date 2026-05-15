export const PLATFORM_NAMES = {
  0: 'MercadoPago',
  1: 'Manual',
  2: 'Voucher',
  3: 'PayPal',
  4: 'Stripe',
  9: 'Antel',
} as const;

export type PlatformId = keyof typeof PLATFORM_NAMES;
export type PlatformName = (typeof PLATFORM_NAMES)[PlatformId];

export function platformName(platform: number): string {
  return (PLATFORM_NAMES as Record<number, string>)[platform] ?? 'Unknown';
}
