// Los formatos del prototipo, tal cual: enteros con separador de miles en
// es-AR, dólares con `$` y hasta dos decimales, fechas cortas en español.

/** Sin redondeos: el entero completo con separador de miles; una fracción,
 *  con dos decimales. */
export function fmt(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  const isInt = Number.isInteger(n);
  return n.toLocaleString(
    'es-AR',
    isInt ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  );
}

export function fmtUsd(n: number): string {
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

/** `$1.234` — el dólar redondeado que el prototipo usa en filas y tablas. */
export function fmtUsdRound(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? '-' : ''}$${fmt(Math.abs(r))}`;
}

/** `12 jul` a partir de 'YYYY-MM-DD'. */
export function fmtDayShort(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** `10 ago 2026`. */
export function fmtDayLong(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** 'YYYY-MM' de cualquier fecha ISO. Las etiquetas de mes del prototipo son
 *  este texto, sin traducir. */
export const ym = (iso: string): string => iso.slice(0, 7);

/** La temporada deportiva (sep→ago) de un mes 'YYYY-MM', por su año inicial. */
export function monthToSeason(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m >= 9 ? y : y - 1;
}

export function seasonLabel(start: number): string {
  return `${String(start).slice(-2)}/${String(start + 1).slice(-2)}`;
}

/** El primer y último mes de una temporada, como 'YYYY-MM'. */
export function seasonFullRange(start: number): { first: string; last: string } {
  return { first: `${start}-09`, last: `${start + 1}-08` };
}

export function pctOf(n: number, total: number): string {
  return total > 0 ? `${((n / total) * 100).toFixed(0)}%` : '—';
}
