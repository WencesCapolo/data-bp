export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** Text colour of a net change: up, down or flat. */
export const netClass = (n: number): string =>
  n > 0 ? 'text-[var(--ok)]' : n < 0 ? 'text-red-700' : 'text-muted';
