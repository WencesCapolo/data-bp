import type { TooltipItem, TooltipOptions } from 'chart.js';
import type { ChartTheme } from '@/lib/client/theme';

/** El tooltip pinta sobre el canvas, así que necesita el color resuelto y no
 *  una variable CSS. Sin `theme` cae en la paleta oscura, que es la de por
 *  defecto de la app. */
export function tooltipBase(theme?: ChartTheme) {
  return {
    backgroundColor: theme?.surface ?? '#0f1525',
    borderColor: theme?.border ?? '#2a3752',
    borderWidth: 1,
    padding: 10,
    titleColor: theme?.theme === 'light' ? '#0f172a' : '#e8edf5',
    bodyColor: theme?.theme === 'light' ? '#334155' : '#e8edf5',
  };
}

export const TOOLTIP_BASE = tooltipBase();

// `tooltipTitles` is aligned index-by-index with the chart's labels: the axis
// keeps its short label, the tooltip shows the full dated one.
export function tooltipOpts(
  tooltipTitles?: string[],
  theme?: ChartTheme,
): Partial<TooltipOptions> {
  const base = tooltipBase(theme);
  if (!tooltipTitles) return base as Partial<TooltipOptions>;
  return {
    ...base,
    callbacks: {
      title: (items: TooltipItem<never>[]) =>
        tooltipTitles[items[0]?.dataIndex ?? -1] ?? String(items[0]?.label ?? ''),
    },
  } as Partial<TooltipOptions>;
}
