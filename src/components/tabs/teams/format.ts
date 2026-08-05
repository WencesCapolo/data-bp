export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

export const netColor = (n: number): string =>
  n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text3)';
