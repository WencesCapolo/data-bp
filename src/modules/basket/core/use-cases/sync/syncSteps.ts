// One factory per Sync step. Each takes exactly what it needs and returns a
// SyncStep; the ordering between them is declared in buildSyncSteps.ts.

import type { ICsvFetcher } from '@basket/core/ports/ICsvFetcher';
import type { IUserRepository } from '@basket/core/ports/IUserRepository';
import type { IPaymentRepository } from '@basket/core/ports/IPaymentRepository';
import type { ITeamRepository, TeamLiveProps } from '@basket/core/ports/ITeamRepository';
import type { ITournamentRepository } from '@basket/core/ports/ITournamentRepository';
import type { IContentRepository } from '@basket/core/ports/IContentRepository';
import type { ISheetsFetcher } from '@basket/core/ports/ISheetsFetcher';
import type { ISheetRowRepository } from '@basket/core/ports/ISheetRowRepository';
import type { IFixtureMatchRepository } from '@basket/core/ports/IFixtureMatchRepository';
import type { ISheetDataMasterRepository } from '@basket/core/ports/ISheetDataMasterRepository';
import type { ISyncStateRepository } from '@basket/core/ports/ISyncStateRepository';
import type { IMaterializedViewRepository } from '@basket/core/ports/IMaterializedViewRepository';
import type { UserProps } from '@basket/core/entities/User';
import type { PaymentProps } from '@basket/core/entities/Payment';
import type { TournamentProps } from '@basket/core/entities/Tournament';
import type { ContentProps } from '@basket/core/entities/Content';
import type { FixtureMatchProps } from '@basket/core/entities/FixtureMatch';
import type { GatewayCustomerProps } from '@basket/core/entities/GatewayCustomer';
import type { GatewayDisputeProps } from '@basket/core/entities/GatewayDispute';
import type { GatewayPayoutProps } from '@basket/core/entities/GatewayPayout';
import type { PaymentUploadRow } from '@basket/core/dtos/PaymentUploadDTO';
import { LoadUsersFromCsvUseCase } from './LoadUsersFromCsvUseCase';
import { LoadPaymentsFromCsvUseCase } from './LoadPaymentsFromCsvUseCase';
import { LoadTournamentsFromCsvUseCase } from './LoadTournamentsFromCsvUseCase';
import { LoadContentFromCsvUseCase } from './LoadContentFromCsvUseCase';
import { LoadSheetUseCase } from './LoadSheetUseCase';
import { LoadFixturesFromSheetUseCase } from './LoadFixturesFromSheetUseCase';
import { LoadSheetDataMastersUseCase } from './LoadSheetDataMastersUseCase';
import { RefreshMaterializedViewsUseCase } from './RefreshMaterializedViewsUseCase';
import { ReconcilePaymentAmountsUseCase } from './ReconcilePaymentAmountsUseCase';
import type { SyncGatewayFeesUseCase } from './SyncGatewayFeesUseCase';
import type { SyncGatewaySubscriptionsUseCase } from './SyncGatewaySubscriptionsUseCase';
import type { SyncGatewayFullMirrorUseCase, SyncGatewayWindowMirrorUseCase } from './SyncGatewayMirrorUseCase';
import type { SyncFxRatesUseCase } from './SyncFxRatesUseCase';
import type { IngestExportInboxUseCase } from './IngestExportInboxUseCase';
import type { FatalStep, NeverFatalStep, PerItemStep } from './SyncStep';

/** Step names. Scope filters, `after` declarations and tests refer to these. */
export const STEP = {
  tournaments: 'tournaments',
  teams: 'teams',
  users: 'users',
  payments: 'payments',
  content: 'content',
  sheets: 'sheets',
  fixtures: 'fixtures',
  dataMasters: 'data-masters',
  fees: 'fees',
  subscriptions: 'subscriptions',
  customers: 'customers',
  disputes: 'disputes',
  payouts: 'payouts',
  fxRates: 'fx-rates',
  exportInbox: 'export-inbox',
  reconcile: 'reconcile',
  refresh: 'refresh',
} as const;

export interface SheetSpec {
  sheetName: string;
  spreadsheetId: string;
  tab: string;
  idColumn?: string;
}

export interface FixtureSheetSpec {
  sourceSheet: string;     // logical slug e.g. 'fixture_lnb_ar'
  spreadsheetId: string;
  tab: string;
  seasonStartYear?: number; // parsed from tab name (e.g. 'Fixture NBB 25/26' → 2025)
}

export interface DataSheetSpec {
  workbookLabel: string;   // e.g. 'NBB_BR'
  spreadsheetId: string;
  tab: string;             // DATA tab name (case may vary)
}

type CsvRow = Record<string, string>;

// ---------------------------------------------------------------------------
// 1–3. Tournaments, teams, users — the Platform's masters. Fatal: nothing after
// them makes sense against a half-written Subscriber table.

export function tournamentsStep(d: {
  fetcher: ICsvFetcher;
  resource: string;
  repo: ITournamentRepository;
  mapRow: (row: CsvRow) => TournamentProps | null;
  syncState: ISyncStateRepository;
}): FatalStep {
  return {
    name: STEP.tournaments,
    policy: 'fatal',
    async run({ runAt }) {
      const rows = mapRows(d.fetcher, d.resource, d.mapRow);
      const r = await new LoadTournamentsFromCsvUseCase(d.repo).execute({ rows });
      await d.syncState.updateLastSync('tournaments', runAt, await d.repo.count());
      return { syncedTournaments: r.inserted };
    },
  };
}

/** Live fields only — id, name, country. League, tier and type are kept if set. */
export function teamsStep(d: {
  fetcher: ICsvFetcher;
  resource: string;
  repo: ITeamRepository;
  mapRow: (row: CsvRow) => TeamLiveProps | null;
  syncState: ISyncStateRepository;
}): FatalStep {
  return {
    name: STEP.teams,
    policy: 'fatal',
    async run({ runAt }) {
      const batch: TeamLiveProps[] = [];
      for await (const row of d.fetcher.streamRows<CsvRow>(d.resource)) {
        const mapped = d.mapRow(row);
        if (mapped) batch.push(mapped);
      }
      const syncedTeams = batch.length === 0 ? 0 : await d.repo.upsertManyFromLive(batch);
      await d.syncState.updateLastSync('teams', runAt, await d.repo.count());
      return { syncedTeams };
    },
  };
}

export function usersStep(d: {
  fetcher: ICsvFetcher;
  resource: string;
  repo: IUserRepository;
  teams: ITeamRepository;
  mapRow: (row: CsvRow, knownTeamIds: Set<number>) => UserProps | null;
  syncState: ISyncStateRepository;
}): FatalStep {
  return {
    name: STEP.users,
    policy: 'fatal',
    after: [STEP.teams],
    async run({ runAt }) {
      const teamIds = await d.teams.getKnownIds();
      const rows = mapRows(d.fetcher, d.resource, (row) => d.mapRow(row, teamIds));
      const r = await new LoadUsersFromCsvUseCase(d.repo).execute({ rows });
      await d.syncState.updateLastSync('users', runAt, await d.repo.count());
      return { syncedUsers: r.inserted };
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Pagos. From a staged Export (an Upload) or from the live `/payments`
// endpoint; after users so `getKnownIds()` reflects this run's Subscribers.

export type PaymentsSource =
  | {
      kind: 'upload';
      rows: AsyncIterable<PaymentUploadRow>;
      mapRow: (row: PaymentUploadRow, knownUserIds: Set<number>) => PaymentProps | null;
    }
  | {
      kind: 'live';
      fetcher: ICsvFetcher;
      resource: string;
      /** Relative window the endpoint understands, e.g. "-1month". */
      window: string;
      mapRow: (row: CsvRow, knownUserIds: Set<number>) => PaymentProps | null;
    };

export function paymentsStep(d: {
  source: PaymentsSource;
  repo: IPaymentRepository;
  users: IUserRepository;
  syncState: ISyncStateRepository;
}): FatalStep {
  return {
    name: STEP.payments,
    policy: 'fatal',
    after: [STEP.users],
    async run({ runAt }) {
      const userIds = await d.users.getKnownIds();
      const skipped = { payments: 0 };
      const rows = d.source.kind === 'upload'
        ? mapUploadedPayments(d.source, userIds, skipped)
        : mapLivePayments(d.source, userIds, skipped);
      const r = await new LoadPaymentsFromCsvUseCase(d.repo).execute({ rows });
      await d.syncState.updateLastSync('payments', runAt, await d.repo.count());
      return { syncedPayments: r.inserted, skippedPayments: skipped.payments };
    },
  };
}

async function* mapUploadedPayments(
  source: Extract<PaymentsSource, { kind: 'upload' }>,
  userIds: Set<number>,
  skipped: { payments: number },
): AsyncGenerator<PaymentProps> {
  for await (const row of source.rows) {
    const mapped = source.mapRow(row, userIds);
    if (mapped) yield mapped;
    else skipped.payments += 1;
  }
}

async function* mapLivePayments(
  source: Extract<PaymentsSource, { kind: 'live' }>,
  userIds: Set<number>,
  skipped: { payments: number },
): AsyncGenerator<PaymentProps> {
  // `/payments` requires Control Panel session cookie (BP_SESSION_COOKIE).
  // Upsert idempotent via PK so rolling window stays cheap.
  let rowsSeen = 0;
  try {
    for await (const row of source.fetcher.streamRows<CsvRow>(source.resource, {
      omitSince: true,
      extraParams: { from: source.window },
    })) {
      rowsSeen += 1;
      const mapped = source.mapRow(row, userIds);
      if (mapped) yield mapped;
      else skipped.payments += 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/403|Must be logged in|No permission/i.test(msg)) {
      throw new Error('Expiró la Cookie');
    }
    throw err;
  }
  // The endpoint now answers 200 with an empty body once the session lapses, so a
  // clean run with zero rows is a failure, not an honestly empty Window. Fail loudly
  // instead of recording a Sync that quietly wrote no Pagos.
  if (rowsSeen === 0) {
    throw new Error('Expiró la Cookie: /payments respondió sin filas CSV');
  }
}

// ---------------------------------------------------------------------------
// 5. Content, windowed.

export function contentStep(d: {
  fetcher: ICsvFetcher;
  resource: string;
  repo: IContentRepository;
  windowDays: number;
  mapRow: (row: CsvRow) => ContentProps | null;
  syncState: ISyncStateRepository;
}): FatalStep {
  return {
    name: STEP.content,
    policy: 'fatal',
    async run({ runAt }) {
      const now = new Date();
      // The endpoint's `to` is exclusive, so asking to=today never returns
      // today's matches. Ask for tomorrow and the tail of the window arrives.
      const to = new Date(now.getTime() + 86400_000);
      const from = new Date(now.getTime() - d.windowDays * 86400_000);
      const ymd = (x: Date) => x.toISOString().slice(0, 10);
      const rows = mapRows(d.fetcher, d.resource, d.mapRow, { extraParams: { from: ymd(from), to: ymd(to) } });
      const r = await new LoadContentFromCsvUseCase(d.repo).execute({ rows });
      await d.syncState.updateLastSync('content', runAt, await d.repo.count());
      return { syncedContent: r.inserted };
    },
  };
}

// ---------------------------------------------------------------------------
// 6, 6b, 6c. Google Sheets, one item per spec. A failed spec records `-1` as
// its row count; the Data Quality tab reads that sentinel.

export function sheetsStep(d: {
  sheets: ISheetsFetcher;
  repo: ISheetRowRepository;
  specs: readonly SheetSpec[];
  syncState: ISyncStateRepository;
}): PerItemStep<SheetSpec> {
  const loader = new LoadSheetUseCase(d.sheets, d.repo);
  return {
    name: STEP.sheets,
    policy: 'per-item',
    items: d.specs,
    itemName: (spec) => spec.sheetName,
    async runItem(spec, { runAt }) {
      const r = await loader.execute(spec);
      await d.syncState.updateLastSync(`sheet:${spec.sheetName}`, runAt, r.inserted);
      return { syncedSheets: [{ sheet: spec.sheetName, inserted: r.inserted }] };
    },
    failedItem: (spec) => ({ syncedSheets: [{ sheet: spec.sheetName, inserted: -1 }] }),
  };
}

export function fixturesStep(d: {
  sheets: ISheetsFetcher;
  repo: IFixtureMatchRepository;
  specs: readonly FixtureSheetSpec[];
  mapRow: (row: CsvRow, sourceSheet: string, seasonStartYear?: number) => FixtureMatchProps | null;
  syncState: ISyncStateRepository;
}): PerItemStep<FixtureSheetSpec> {
  const loader = new LoadFixturesFromSheetUseCase(d.sheets, d.repo, d.mapRow);
  return {
    name: STEP.fixtures,
    policy: 'per-item',
    items: d.specs,
    itemName: (spec) => spec.sourceSheet,
    async runItem(spec, { runAt }) {
      const r = await loader.execute(spec);
      await d.syncState.updateLastSync(`fixture:${spec.sourceSheet}`, runAt, r.inserted);
      return { syncedFixtures: [{ sheet: spec.sourceSheet, inserted: r.inserted }] };
    },
    failedItem: (spec) => ({ syncedFixtures: [{ sheet: spec.sourceSheet, inserted: -1 }] }),
  };
}

export function dataMastersStep(d: {
  sheets: ISheetsFetcher;
  repo: ISheetDataMasterRepository;
  specs: readonly DataSheetSpec[];
  syncState: ISyncStateRepository;
}): PerItemStep<DataSheetSpec> {
  const loader = new LoadSheetDataMastersUseCase(d.sheets, d.repo);
  return {
    name: STEP.dataMasters,
    policy: 'per-item',
    items: d.specs,
    itemName: (spec) => spec.workbookLabel,
    async runItem(spec, { runAt }) {
      const r = await loader.execute(spec);
      await d.syncState.updateLastSync(`data:${spec.workbookLabel}`, runAt, r.teams + r.cambios + r.dias);
      return { syncedDataMasters: [{ workbook: spec.workbookLabel, ...r }] };
    },
    failedItem: (spec) => ({
      syncedDataMasters: [{ workbook: spec.workbookLabel, teams: -1, cambios: -1, dias: -1 }],
    }),
  };
}

// ---------------------------------------------------------------------------
// 7–8d. Providers. Never fatal: a gateway outage must not cost the Pagos sync
// that already succeeded. Each child use case owns its own watermark
// (`fees:<slug>`, ...) and advances it only on a clean run — see ADR 0006.

/** 7. Fees — delta from the child's own watermark minus an overlap. */
export function feesStep(d: {
  useCase: SyncGatewayFeesUseCase;
  overlapDays: number;
  windowDays: number;
}): NeverFatalStep {
  return {
    name: STEP.fees,
    policy: 'never-fatal',
    after: [STEP.payments],
    run: async () => ({
      gatewayFees: await d.useCase.execute({ overlapDays: d.overlapDays, windowDays: d.windowDays }),
    }),
  };
}

/** 8. Subscriptions — full refresh, not a window. A cancellation is an update to
 *  an object created long ago, so there is no delta to read (ADR 0006). */
export function subscriptionsStep(d: { useCase: SyncGatewaySubscriptionsUseCase }): NeverFatalStep {
  return {
    name: STEP.subscriptions,
    policy: 'never-fatal',
    run: async () => ({ gatewaySubscriptions: await d.useCase.execute() }),
  };
}

/** 8b. Customers — full refresh, same trap as cancellation. */
export function customersStep(d: {
  useCase: SyncGatewayFullMirrorUseCase<GatewayCustomerProps>;
}): NeverFatalStep {
  return {
    name: STEP.customers,
    policy: 'never-fatal',
    run: async () => ({ gatewayMirrors: await d.useCase.execute() }),
  };
}

export interface MirrorWindow {
  overlapDays: number;
  windowDays: number;
}

/** 8b. Disputes — window plus overlap. */
export function disputesStep(d: {
  useCase: SyncGatewayWindowMirrorUseCase<GatewayDisputeProps>;
  window: MirrorWindow;
}): NeverFatalStep {
  return {
    name: STEP.disputes,
    policy: 'never-fatal',
    run: async () => ({ gatewayMirrors: await d.useCase.execute(d.window) }),
  };
}

/** 8b. Payouts — window plus overlap. */
export function payoutsStep(d: {
  useCase: SyncGatewayWindowMirrorUseCase<GatewayPayoutProps>;
  window: MirrorWindow;
}): NeverFatalStep {
  return {
    name: STEP.payouts,
    policy: 'never-fatal',
    run: async () => ({ gatewayMirrors: await d.useCase.execute(d.window) }),
  };
}

/** 8c. FX rates. After fees because the derived Stripe rows are read out of the
 *  fee mirror; running first would name a rate from before this run's charges. */
export function fxRatesStep(d: { useCase: SyncFxRatesUseCase }): NeverFatalStep {
  return {
    name: STEP.fxRates,
    policy: 'never-fatal',
    after: [STEP.fees],
    async run() {
      const fxRates = await d.useCase.execute();
      for (const r of fxRates) {
        if (r.error) console.error(`fx ${r.source} failed: ${r.error}`);
      }
      return { fxRates };
    },
  };
}

/** 8d. Provider Exports waiting in the SFTP inbox. Before reconciliation, which
 *  reads the fee mirror as truth. The use case isolates each file itself. */
export function exportInboxStep(d: { useCase: IngestExportInboxUseCase }): NeverFatalStep {
  return {
    name: STEP.exportInbox,
    policy: 'never-fatal',
    async run() {
      const exportInbox = await d.useCase.execute();
      if (exportInbox.error) console.error(`export inbox failed: ${exportInbox.error}`);
      for (const f of exportInbox.files) {
        if (f.outcome === 'ingested') {
          console.log(`inbox ${f.filename}: ${f.rows} rows, ${f.upserted} upserted`);
        } else if (f.outcome !== 'skipped') {
          console.error(`inbox ${f.filename} ${f.outcome}: ${f.error}`);
        }
      }
      return { exportInbox };
    },
  };
}

// ---------------------------------------------------------------------------
// 9, 10. Realign, then rebuild.

/** 9. Realign Pago amounts against the gateway. After fees (it reads them as
 *  truth) and the inbox (which may add fee rows); before the refresh, because
 *  amount feeds tier classification. Never fatal. See docs/adr/0006. */
export function reconcileStep(d: { repo: IPaymentRepository }): NeverFatalStep {
  return {
    name: STEP.reconcile,
    policy: 'never-fatal',
    after: [STEP.payments, STEP.fees, STEP.exportInbox],
    async run() {
      const r = await new ReconcilePaymentAmountsUseCase(d.repo).execute();
      if (r.corrected > 0) console.log(`realigned ${r.corrected} Pago amounts to the gateway`);
      return { correctedAmounts: r.corrected };
    },
  };
}

/** 10. Rebuild every derived table. Fatal: a Sync that ends without it has
 *  changed nothing anyone can see. Always last. */
export function refreshStep(d: { matViews: IMaterializedViewRepository }): FatalStep {
  return {
    name: STEP.refresh,
    policy: 'fatal',
    after: [STEP.reconcile],
    run: async () => ({
      refreshes: await new RefreshMaterializedViewsUseCase(d.matViews).execute({ concurrent: true }),
    }),
  };
}

// ---------------------------------------------------------------------------

async function* mapRows<T>(
  fetcher: ICsvFetcher,
  resource: string,
  mapRow: (row: CsvRow) => T | null,
  options?: { extraParams?: Record<string, string> },
): AsyncGenerator<T> {
  for await (const row of fetcher.streamRows<CsvRow>(resource, options)) {
    const mapped = mapRow(row);
    if (mapped) yield mapped;
  }
}
