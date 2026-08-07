import type { TooltipItem, TooltipOptions } from 'chart.js';

export const TOOLTIP_BASE = {
  backgroundColor: '#0f1525',
  borderColor: '#2a3752',
  borderWidth: 1,
  padding: 10,
};

// `tooltipTitles` is aligned index-by-index with the chart's labels: the axis
// keeps its short label, the tooltip shows the full dated one.
export function tooltipOpts(tooltipTitles?: string[]): Partial<TooltipOptions> {
  if (!tooltipTitles) return TOOLTIP_BASE as Partial<TooltipOptions>;
  return {
    ...TOOLTIP_BASE,
    callbacks: {
      title: (items: TooltipItem<never>[]) =>
        tooltipTitles[items[0]?.dataIndex ?? -1] ?? String(items[0]?.label ?? ''),
    },
  } as Partial<TooltipOptions>;
}
