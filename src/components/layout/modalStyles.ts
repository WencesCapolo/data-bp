/**
 * The classes the two Upload dialogs share (SyncModal, FeeUploadModal): one
 * look for one screen, without merging two flows that only look alike.
 */
export const M = {
  overlay:
    'fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[rgba(28,13,16,0.45)] px-4 py-12 backdrop-blur-sm max-sm:px-2.5 max-sm:py-4',
  dialog: 'card w-full max-w-[620px] shadow-[var(--shadow-lift)] outline-hidden',
  head: 'flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4',
  title: 'font-display text-xl font-semibold tracking-[0.04em] uppercase',
  step: 'font-mono text-[11px] text-muted',
  body: 'p-5',
  foot: 'flex items-center justify-end gap-2.5 border-t border-[var(--border)] px-5 py-4',
  intro: 'mb-3.5 text-xs leading-relaxed text-n-700',
  note: 'text-[11px] leading-relaxed text-muted',
  checklist:
    "mb-4 grid gap-2 [&_li]:relative [&_li]:pl-[22px] [&_li]:text-xs [&_li]:leading-relaxed [&_li]:text-n-700 [&_li]:before:absolute [&_li]:before:top-px [&_li]:before:left-0 [&_li]:before:grid [&_li]:before:size-[15px] [&_li]:before:place-items-center [&_li]:before:rounded-full [&_li]:before:bg-amber-100 [&_li]:before:font-mono [&_li]:before:text-[10px] [&_li]:before:font-bold [&_li]:before:text-amber-700 [&_li]:before:content-['!'] [&_strong]:font-semibold [&_strong]:text-foreground",
  stats: 'mb-4 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2.5 max-sm:grid-cols-2',
  stat: 'rounded-lg border border-[var(--border)] bg-[var(--background-soft)] px-3 py-2.5',
  statLabel: 'eyebrow mb-1 text-[10px]',
  statValue: 'font-mono text-lg text-foreground tabular-nums',
  kv: 'flex justify-between gap-3 border-b border-[var(--border)] py-1.5 font-mono text-xs text-n-700 last:border-b-0',
  link: 'cursor-pointer text-[11px] text-sky-700 underline hover:text-sky-900',
  primary: 'btn-primary px-3.5 py-2 text-[13px]',
} as const;

/** Error / warning / info boxes inside a dialog. */
export const ADVICE = {
  error: 'mb-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-800',
  warn: 'mb-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900',
  info: 'mb-2.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs leading-relaxed text-sky-900',
} as const;

/** The drop target for the Export. */
export function dropzone({ dragging, hasFile }: { dragging: boolean; hasFile: boolean }): string {
  const base =
    'block w-full cursor-pointer rounded-[var(--panel-radius)] border border-dashed px-[18px] py-[26px] text-center text-xs text-n-700 transition-colors hover:border-accent disabled:cursor-wait';
  if (dragging) return `${base} border-accent bg-accent-soft`;
  if (hasFile) return `${base} border-solid border-[var(--ok)] bg-[var(--ok-soft)]`;
  return `${base} border-n-300 bg-[var(--background-soft)]`;
}
