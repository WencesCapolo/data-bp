/**
 * The dashboards' chart colours. Chart.js paints on a canvas and cannot read a
 * CSS variable, so the values live here as strings. They are tuned for the
 * light surface of basket-tv-ui (white cards on the warm neutral canvas).
 */

/** Categorical series, in the order a chart should use them. */
export const SERIES = [
  '#2563eb', // blue
  '#0891b2', // cyan
  '#e11d48', // rose
  '#7c3aed', // violet
  '#059669', // emerald
  '#ea580c', // orange
  '#847b78', // warm neutral (--n-500): "other"
  '#e31b23', // brand red (--accent)
] as const;

/** One colour per country, the same on every chart. */
export const COUNTRY: Record<string, string> = {
  AR: '#2563eb',
  UY: '#0891b2',
  CL: '#e11d48',
  EC: '#7c3aed',
  BR: '#059669',
  BO: '#ea580c',
};
export const OTHER = '#847b78';

/** One colour per access type: paid, voucher ($0) and Antel. */
export const ACCESS = { real: '#1f7a4d', voucher: '#d97706', antel: '#0891b2' } as const;

/** Up / down / flat, for deltas painted on a canvas. */
export const TREND = { up: '#1f7a4d', down: '#c0141b', flat: '#847b78' } as const;

/** Axis, grid and tooltip colours: the basket-tv-ui neutrals. */
export interface ChartTheme {
  grid: string;
  tick: string;
  /** Card surface: doughnut rings are separated with it. */
  surface: string;
  border: string;
  title: string;
  body: string;
}

export const CHART_THEME: ChartTheme = {
  grid: '#e7e4e2', // --n-200
  tick: '#6b615f', // --n-600
  surface: '#ffffff', // --surface
  border: '#d6d1ce', // --n-300
  title: '#1c0d10', // --n-900
  body: '#4a423f', // --n-700
};
