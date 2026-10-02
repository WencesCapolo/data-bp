import type { TooltipItem, TooltipOptions } from 'chart.js';
import { CHART_THEME, type ChartTheme } from '@/lib/client/palette';

/** The tooltip paints on the canvas, so it needs resolved colours, not CSS
 *  variables: a white card with the shared border, like the InfoHint bubble. */
export function tooltipBase(theme: ChartTheme = CHART_THEME) {
  return {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
    titleColor: theme.title,
    bodyColor: theme.body,
  };
}

export const TOOLTIP_BASE = tooltipBase();

// `tooltipTitles` is aligned index-by-index with the chart's labels: the axis
// keeps its short label, the tooltip shows the full dated one.
export function tooltipOpts(
  tooltipTitles?: string[],
  theme: ChartTheme = CHART_THEME,
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
