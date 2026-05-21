import { CsvApiFetcher } from '@basket/infrastructure/csv/CsvApiFetcher';
import { DrizzleUserRepository } from '@basket/infrastructure/db/repositories/DrizzleUserRepository';
import { DrizzlePaymentRepository } from '@basket/infrastructure/db/repositories/DrizzlePaymentRepository';
import { DrizzleTeamRepository } from '@basket/infrastructure/db/repositories/DrizzleTeamRepository';
import { DrizzleTournamentRepository } from '@basket/infrastructure/db/repositories/DrizzleTournamentRepository';
import { DrizzleContentRepository } from '@basket/infrastructure/db/repositories/DrizzleContentRepository';
import { DrizzleSheetRowRepository } from '@basket/infrastructure/db/repositories/DrizzleSheetRowRepository';
import { DrizzleFixtureMatchRepository } from '@basket/infrastructure/db/repositories/DrizzleFixtureMatchRepository';
import { DrizzleSheetDataMasterRepository } from '@basket/infrastructure/db/repositories/DrizzleSheetDataMasterRepository';
import { GoogleSheetsFetcher } from '@basket/infrastructure/sheets/GoogleSheetsFetcher';
import type { SheetSpec, FixtureSheetSpec, DataSheetSpec } from '@basket/core/use-cases/sync/RunSyncUseCase';
import { DrizzleSyncStateRepository } from '@basket/infrastructure/db/repositories/DrizzleSyncStateRepository';
import { DrizzleMaterializedViewRepository } from '@basket/infrastructure/db/repositories/DrizzleMaterializedViewRepository';
import {
  mapUserRow,
  mapPaymentRow,
  mapTournamentRow,
  mapTeamLiveRow,
  mapContentRow,
  type UserCsvRow,
  type PaymentCsvRow,
  type TournamentCsvRow,
  type TeamLiveCsvRow,
  type ContentCsvRow,
} from '@basket/infrastructure/sync/csvMappers';
import { mapFixtureMatchRow } from '@basket/infrastructure/sync/fixtureMappers';
import { RunSyncUseCase } from '@basket/core/use-cases/sync/RunSyncUseCase';

const MONTH_TAB_RX = /^(Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre)\s+\d{2,4}$/i;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// Extracts season start year from a tab like 'Fixture NBB 25/26' → 2025.
function parseSeasonYear(tab: string): number | undefined {
  const m = tab.match(/(\d{2,4})\s*\/\s*\d{2,4}/);
  if (!m) return undefined;
  let y = Number(m[1]);
  if (!Number.isFinite(y)) return undefined;
  if (y < 100) y += 2000;
  return y;
}

// Scans process.env for `GOOGLE_SHEETS_FIXTURE_<LABEL>_ID` + matching `_TAB`.
// Optional `_TABS` allows comma-separated list (multi-tab workbooks like Uruguay).
function discoverFixtureSpecs(): FixtureSheetSpec[] {
  const specs: FixtureSheetSpec[] = [];
  const idRx = /^GOOGLE_SHEETS_FIXTURE_([A-Z0-9_]+)_ID$/;
  for (const key of Object.keys(process.env)) {
    const m = key.match(idRx);
    if (!m) continue;
    const label = m[1];
    const id = process.env[key];
    if (!id) continue;
    const singleTab = process.env[`GOOGLE_SHEETS_FIXTURE_${label}_TAB`];
    const multiTabs = process.env[`GOOGLE_SHEETS_FIXTURE_${label}_TABS`];
    const tabs = multiTabs
      ? multiTabs.split(',').map((t) => t.trim()).filter(Boolean)
      : singleTab
        ? [singleTab]
        : [];
    if (tabs.length === 0) continue;
    for (const tab of tabs) {
      const slug = tab
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      const isMulti = tabs.length > 1;
      specs.push({
        sourceSheet: isMulti ? `fixture_${label.toLowerCase()}_${slug}` : `fixture_${label.toLowerCase()}`,
        spreadsheetId: id,
        tab,
        seasonStartYear: parseSeasonYear(tab),
      });
    }
  }
  return specs;
}

export async function composeRunSync(): Promise<RunSyncUseCase> {
  const baseUrl = process.env.EXTERNAL_API_BASE;
  if (!baseUrl) throw new Error('EXTERNAL_API_BASE not set');
  const token = process.env.BP_TOKEN ?? process.env.EXTERNAL_API_KEY;
  const authMode = process.env.BP_TOKEN ? 'query-token' : 'bearer';
  const paymentsEnabled = process.env.SYNC_PAYMENTS_ENABLED !== 'false';

  const fetcher = new CsvApiFetcher({
    baseUrl,
    authMode,
    apiKey: token,
    tokenParam: 'token',
    delimiter: ';',
    sinceParam: process.env.EXTERNAL_SINCE_PARAM ?? 'since',
  });

  const users = new DrizzleUserRepository();
  const payments = new DrizzlePaymentRepository();
  const teams = new DrizzleTeamRepository();
  const tournaments = new DrizzleTournamentRepository();
  const content = new DrizzleContentRepository();
  const syncState = new DrizzleSyncStateRepository();
  const matViews = new DrizzleMaterializedViewRepository();
  const sheetRows = new DrizzleSheetRowRepository();
  const fixtureMatches = new DrizzleFixtureMatchRepository();
  const sheetDataMasters = new DrizzleSheetDataMasterRepository();

  const gEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const gKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheets = gEmail && gKey
    ? new GoogleSheetsFetcher({ email: gEmail, privateKey: gKey })
    : undefined;

  const sheetSpecs: SheetSpec[] = [];
  if (sheets && process.env.GOOGLE_SHEETS_ID_INCIDENCIAS) {
    sheetSpecs.push({
      sheetName: 'incidents',
      spreadsheetId: process.env.GOOGLE_SHEETS_ID_INCIDENCIAS,
      tab: process.env.GOOGLE_SHEETS_TAB_INCIDENCIAS ?? 'Incidencias',
      idColumn: 'ID',
    });
  }

  // Grilla: one logical sheet per month tab. Auto-discover.
  if (sheets && process.env.GOOGLE_SHEETS_ID_GRILLA) {
    const id = process.env.GOOGLE_SHEETS_ID_GRILLA;
    try {
      const tabs = await sheets.listTabs(id);
      for (const tab of tabs) {
        if (!MONTH_TAB_RX.test(tab)) continue;
        sheetSpecs.push({
          sheetName: `grilla_${slugify(tab)}`,
          spreadsheetId: id,
          tab,
          idColumn: 'ID',
        });
      }
    } catch (err) {
      console.error('grilla listTabs failed:', (err as Error).message);
    }
  }

  const fixtureSpecs: FixtureSheetSpec[] = sheets ? discoverFixtureSpecs() : [];

  // Discover DATA tabs per fixture workbook (case-insensitive 'data' match).
  const dataSheetSpecs: DataSheetSpec[] = [];
  if (sheets) {
    const idRx = /^GOOGLE_SHEETS_FIXTURE_([A-Z0-9_]+)_ID$/;
    const seenWorkbooks = new Set<string>();
    for (const key of Object.keys(process.env)) {
      const m = key.match(idRx);
      if (!m) continue;
      const label = m[1];
      const id = process.env[key];
      if (!id || seenWorkbooks.has(label)) continue;
      seenWorkbooks.add(label);
      try {
        const tabs = await sheets.listTabs(id);
        const dataTab = tabs.find((t) => /^data$/i.test(t));
        if (dataTab) dataSheetSpecs.push({ workbookLabel: label, spreadsheetId: id, tab: dataTab });
      } catch (err) {
        console.error(`data discover ${label} failed:`, (err as Error).message);
      }
    }
  }

  return new RunSyncUseCase({
    fetcher,
    users,
    payments,
    teams,
    tournaments,
    content,
    sheets,
    sheetRows,
    sheetSpecs,
    fixtureMatches,
    fixtureSpecs,
    sheetDataMasters,
    dataSheetSpecs,
    syncState,
    matViews,
    mapUserRow: (row, teamIds) => mapUserRow(row as unknown as UserCsvRow, teamIds),
    mapPaymentRow: (row, userIds) => mapPaymentRow(row as unknown as PaymentCsvRow, userIds),
    mapTournamentRow: (row) => mapTournamentRow(row as unknown as TournamentCsvRow),
    mapTeamLiveRow: (row) => mapTeamLiveRow(row as unknown as TeamLiveCsvRow),
    mapContentRow: (row) => mapContentRow(row as unknown as ContentCsvRow),
    mapFixtureRow: (row, src, year) => mapFixtureMatchRow(row, src, year),
    usersResource: process.env.EXTERNAL_USERS_PATH ?? 'users',
    paymentsResource: process.env.EXTERNAL_PAYMENTS_PATH ?? 'payments',
    teamsResource: process.env.EXTERNAL_TEAMS_PATH ?? 'teams',
    tournamentsResource: process.env.EXTERNAL_TOURNAMENTS_PATH ?? 'tournaments',
    contentResource: process.env.EXTERNAL_CONTENT_PATH ?? 'content',
    contentWindowDays: Number(process.env.SYNC_CONTENT_WINDOW_DAYS ?? '30'),
    paymentsEnabled,
    contentEnabled: process.env.SYNC_CONTENT_ENABLED !== 'false',
  });
}
