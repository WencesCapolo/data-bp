export type AccessType = 'real' | 'voucher' | 'antel';

export function classifyAccessType(platform: number, amount: number): AccessType {
  if (platform === 9) return 'antel';
  if (amount > 0) return 'real';
  return 'voucher';
}

export function isPaid(accessType: AccessType): boolean {
  return accessType === 'real' || accessType === 'antel';
}
