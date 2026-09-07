/** Offset the Control Panel's wall clock runs on: -03:00 (Argentina/Uruguay, no DST). */
export const PANEL_UTC_OFFSET_MS = -3 * 3_600_000;

const PANEL_DATE_RX = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parses the `dd/mm/yyyy HH:MM` stamps the Control Panel writes into a Pagos Export.
 *
 * Timezone: the Export omits any offset, while the (now dead) API CSVs carried an
 * explicit one — `2020-10-01T03:25:26-03:00` — which `new Date()` resolves to the
 * right instant on its own. To keep both paths on one clock we pin Export stamps to
 * that same `-03:00` instead of the host's local zone: the app runs on UTC servers,
 * so relying on local time would shift every Pago three hours later than it happened
 * and slide rows across day and month boundaries in the dashboards.
 *
 * This is the one parser for that stamp. The Upload preview, the mapper that
 * writes the mirror and the provenance row all read it, so the Window an Analyst
 * confirms is the Window that lands.
 */
export function parsePanelDate(value: string | undefined | null): Date | null {
  const m = (value ?? '').trim().match(PANEL_DATE_RX);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const hour = Number(hh);
  const minute = Number(min);
  const second = ss ? Number(ss) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  // Wall-clock instant first, then shifted onto the panel's offset.
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const wall = new Date(wallMs);
  // Rejects overflow like 31/02, which Date.UTC would roll into the next month.
  if (wall.getUTCMonth() + 1 !== month || wall.getUTCDate() !== day) return null;
  return new Date(wallMs - PANEL_UTC_OFFSET_MS);
}
