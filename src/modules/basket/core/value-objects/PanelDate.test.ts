import { describe, expect, it } from 'vitest';
import { parsePanelDate } from './PanelDate';

describe('parsePanelDate', () => {
  it('pins a panel stamp to -03:00, not to UTC', () => {
    // 28/07/2026 22:30 on the panel's wall clock is 01:30 UTC the next day.
    expect(parsePanelDate('28/07/2026 22:30')?.toISOString()).toBe('2026-07-29T01:30:00.000Z');
  });

  it('accepts one-digit day, month and hour, and optional seconds', () => {
    expect(parsePanelDate('3/8/2026 9:05')?.toISOString()).toBe('2026-08-03T12:05:00.000Z');
    expect(parsePanelDate('03/08/2026 09:05:45')?.toISOString()).toBe('2026-08-03T12:05:45.000Z');
  });

  it('rejects overflowing dates and non-panel formats', () => {
    expect(parsePanelDate('31/02/2026 10:00')).toBeNull();
    expect(parsePanelDate('2026-07-28T22:30:00Z')).toBeNull();
    expect(parsePanelDate('')).toBeNull();
    expect(parsePanelDate(undefined)).toBeNull();
  });
});
