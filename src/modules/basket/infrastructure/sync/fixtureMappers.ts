import type { FixtureMatchProps } from '@basket/core/entities/FixtureMatch';

function emptyToNull(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  return s.length > 0 ? s : null;
}

function firstNonEmpty(row: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v && v.trim().length > 0) return v;
  }
  return undefined;
}

// Parses dd/mm/yyyy, d/m/yyyy, dd/mm/yy. If no year and seasonStartYear given,
// infer: month>=8 → seasonStartYear, else seasonStartYear+1.
function parseDate(raw: string | undefined, seasonStartYear?: number): Date | null {
  if (!raw) return null;
  // Strip leading weekday/non-digit prefix like "DO 26/10/25" or "miércoles 26/10".
  const cleaned = raw.trim().replace(/^[^\d]*/, '');
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let y: number;
  if (m[3]) {
    y = Number(m[3]);
    if (y < 100) y += 2000;
    if (y < 1900 || y > 2100) return null;
  } else if (seasonStartYear !== undefined) {
    y = mo >= 8 ? seasonStartYear : seasonStartYear + 1;
  } else {
    return null;
  }
  return new Date(Date.UTC(y, mo - 1, d));
}

export function mapFixtureMatchRow(
  row: Record<string, string>,
  sourceSheet: string,
  seasonStartYear?: number,
): FixtureMatchProps | null {
  const id = Number(row.ID ?? row.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  // Date: scan FECHA/DIA candidates, pick first that parses (LNB uses FECHA,
  // Uruguay uses DIA, NBB FECHA — DIA may be weekday text in LNB).
  let matchDate: Date | null = null;
  for (const k of ['FECHA', 'Fecha', 'fecha', 'DIA', 'DÍA', 'Dia']) {
    const v = row[k];
    if (!v) continue;
    const d = parseDate(v, seasonStartYear);
    if (d) { matchDate = d; break; }
  }

  // Time: HORA (LNB/NBB), HORA ESP (FEB ES), INICIO PARTIDO (Uruguay), fallbacks.
  const time = emptyToNull(firstNonEmpty(row, 'HORA', 'Hora', 'HORA ESP', 'CHI', 'HORA ECU', 'Hora ARG', 'HORA ARG', 'ARG', 'GMT', 'INICIO PARTIDO', 'INICIO TRANS'));

  // Teams: LOCAL/VISITANTE columns when present, else split PARTIDO on newline (FEB ES).
  let homeTeam = emptyToNull(row.LOCAL ?? row.Local);
  let awayTeam = emptyToNull(row.VISITANTE ?? row.Visitante);
  if (!homeTeam && !awayTeam) {
    const partido = row.PARTIDO ?? row.Partido;
    if (partido) {
      const parts = partido.split(/\n|\s+-\s+|\s+vs\.?\s+/i).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) { homeTeam = parts[0]; awayTeam = parts[1]; }
    }
  }

  return {
    id,
    matchDate,
    matchTime: time,
    homeTeam,
    awayTeam,
    venue: emptyToNull(firstNonEmpty(row, 'ESTADIO', 'Estadio')),
    broadcaster: emptyToNull(firstNonEmpty(row, 'TV', 'TRANSMISIÓN', 'TRANSMISION', 'Transmisión')),
    sourceSheet,
  };
}
