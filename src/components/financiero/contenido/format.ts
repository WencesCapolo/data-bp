// The prototype's three number formats, kept apart because they answer three
// different questions. Totals are read at a glance (days + hours); averages are
// compared against each other (h:mm:ss); counts are counts.

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('es-UY');
}

/** A large total: days and hours, or hours and minutes below a day. */
export function fmtSecondsLong(secs: number): string {
  if (!secs || !Number.isFinite(secs)) return '—';
  const s = Math.round(secs);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  if (days > 0) return `${fmt(days)} días ${hours} h`;
  const min = Math.floor((s % 3600) / 60);
  return `${fmt(hours)} h ${min} min`;
}

/** An average: compact enough to sit in a KPI next to two others. */
export function fmtSecondsShort(secs: number): string {
  if (!secs || !Number.isFinite(secs)) return '—';
  const s = Math.round(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min ${String(sec).padStart(2, '0')} s`;
  if (m > 0) return `${m} min ${String(sec).padStart(2, '0')} s`;
  return `${sec} s`;
}

/**
 * Sporting seasons, Sep→Aug, as the prototype's quick filter offers them: the
 * label names both halves so nobody has to know the convention to read it.
 */
export function seasonRange(startYear: number): { from: string; to: string; label: string } {
  return {
    from: `${startYear}-09-01`,
    to: `${startYear + 1}-08-31`,
    label: `${String(startYear).slice(2)}/${String(startYear + 1).slice(2)}`,
  };
}
