// Parses workbook DATA tabs. Layout = multiple independent column-blocks
// crammed side-by-side. Detects role per column via header keyword and emits
// three lists: teams, cambios, dias.

export interface TeamMasterRow {
  workbookLabel: string;
  nameFull: string;
  nameShort: string | null;
  siglas: string | null;
  stadium: string | null;
  city: string | null;
  officialPage: string | null;
}

export interface EnumRow {
  workbookLabel: string;
  label: string;
  position: number;
}

export interface ParsedDataSheet {
  teams: TeamMasterRow[];
  cambios: EnumRow[];
  dias: EnumRow[];
}

type Role =
  | 'team_name'
  | 'team_short'
  | 'team_siglas'
  | 'team_stadium'
  | 'team_city'
  | 'team_page'
  | 'cambios'
  | 'dias';

function normalize(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function classify(header: string): Role | null {
  const n = normalize(header);
  if (!n) return null;
  if (n === 'equipos' || n === 'equipo' || n === 'nombre completo' || n === 'nombre oficial') return 'team_name';
  if (n === 'nombre corto') return 'team_short';
  if (n === 'siglas') return 'team_siglas';
  if (n === 'estadio' || n === 'estadios') return 'team_stadium';
  if (n === 'ciudad') return 'team_city';
  if (n === 'pagina oficial') return 'team_page';
  if (n === 'cambios') return 'cambios';
  if (n === 'dias' || n === 'dia') return 'dias';
  return null;
}

function findHeaderRow(grid: string[][]): number {
  let best = -1;
  let bestScore = 0;
  const scanLimit = Math.min(5, grid.length);
  for (let i = 0; i < scanLimit; i++) {
    const row = grid[i] ?? [];
    let score = 0;
    for (const cell of row) if (classify(cell)) score++;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

function emptyToNull(s: string): string | null {
  const t = s.trim();
  return t.length > 0 ? t : null;
}

export function parseDataSheet(grid: string[][], workbookLabel: string): ParsedDataSheet {
  const headerIdx = findHeaderRow(grid);
  if (headerIdx < 0) return { teams: [], cambios: [], dias: [] };

  const header = grid[headerIdx];
  const colRole = new Map<number, Role>();
  for (let c = 0; c < header.length; c++) {
    const role = classify(header[c]);
    if (role) colRole.set(c, role);
  }

  const colByRole = new Map<Role, number>();
  for (const [c, r] of colRole) {
    if (!colByRole.has(r)) colByRole.set(r, c);
  }

  const nameCol = colByRole.get('team_name');
  const cambiosCol = colByRole.get('cambios');
  const diasCol = colByRole.get('dias');

  const teams: TeamMasterRow[] = [];
  const cambios: EnumRow[] = [];
  const dias: EnumRow[] = [];
  const seenTeam = new Set<string>();
  const seenCambio = new Set<string>();
  const seenDia = new Set<string>();

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const cell = (c: number | undefined) => (c == null ? '' : (row[c] ?? ''));

    if (nameCol != null) {
      const nameFull = cell(nameCol).trim();
      if (nameFull && !seenTeam.has(nameFull)) {
        seenTeam.add(nameFull);
        teams.push({
          workbookLabel,
          nameFull,
          nameShort: emptyToNull(cell(colByRole.get('team_short'))),
          siglas: emptyToNull(cell(colByRole.get('team_siglas'))),
          stadium: emptyToNull(cell(colByRole.get('team_stadium'))),
          city: emptyToNull(cell(colByRole.get('team_city'))),
          officialPage: emptyToNull(cell(colByRole.get('team_page'))),
        });
      }
    }

    if (cambiosCol != null) {
      const v = cell(cambiosCol).trim();
      if (v && !seenCambio.has(v)) {
        seenCambio.add(v);
        cambios.push({ workbookLabel, label: v, position: cambios.length });
      }
    }

    if (diasCol != null) {
      const v = cell(diasCol).trim();
      if (v && !seenDia.has(v)) {
        seenDia.add(v);
        dias.push({ workbookLabel, label: v, position: dias.length });
      }
    }
  }

  return { teams, cambios, dias };
}
