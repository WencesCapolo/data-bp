import type { ICsvFetcher } from '@basket/core/ports/ICsvFetcher';
import type { IUserRepository } from '@basket/core/ports/IUserRepository';
import type { IPaymentRepository } from '@basket/core/ports/IPaymentRepository';
import type { ITeamRepository, TeamLiveProps } from '@basket/core/ports/ITeamRepository';
import type { ITournamentRepository } from '@basket/core/ports/ITournamentRepository';
import type { IContentRepository } from '@basket/core/ports/IContentRepository';
import type { ISheetsFetcher } from '@basket/core/ports/ISheetsFetcher';
import type { ISheetRowRepository } from '@basket/core/ports/ISheetRowRepository';
import type { IFixtureMatchRepository } from '@basket/core/ports/IFixtureMatchRepository';
import type { ISyncStateRepository } from '@basket/core/ports/ISyncStateRepository';
import type { IMaterializedViewRepository, RefreshResult } from '@basket/core/ports/IMaterializedViewRepository';
import type { UserProps } from '@basket/core/entities/User';
import type { PaymentProps } from '@basket/core/entities/Payment';
import type { TournamentProps } from '@basket/core/entities/Tournament';
import type { ContentProps } from '@basket/core/entities/Content';
import type { FixtureMatchProps } from '@basket/core/entities/FixtureMatch';
import type { PaymentUploadRow } from '@basket/core/dtos/PaymentUploadDTO';
import { LoadUsersFromCsvUseCase } from './LoadUsersFromCsvUseCase';
import { LoadPaymentsFromCsvUseCase } from './LoadPaymentsFromCsvUseCase';
import { LoadTournamentsFromCsvUseCase } from './LoadTournamentsFromCsvUseCase';
import { LoadContentFromCsvUseCase } from './LoadContentFromCsvUseCase';
import { LoadSheetUseCase } from './LoadSheetUseCase';
import { LoadFixturesFromSheetUseCase } from './LoadFixturesFromSheetUseCase';
import { LoadSheetDataMastersUseCase } from './LoadSheetDataMastersUseCase';
import type { ISheetDataMasterRepository } from '@basket/core/ports/ISheetDataMasterRepository';
import { RefreshMaterializedViewsUseCase } from './RefreshMaterializedViewsUseCase';
import { SyncGatewayFeesUseCase, type GatewayFeeSyncResult } from './SyncGatewayFeesUseCase';
import {
  SyncGatewaySubscriptionsUseCase,
  type GatewaySubscriptionSyncResult,
} from './SyncGatewaySubscriptionsUseCase';
import { ReconcilePaymentAmountsUseCase } from './ReconcilePaymentAmountsUseCase';
import {
  SyncGatewayFullMirrorUseCase,
  SyncGatewayWindowMirrorUseCase,
  type GatewayMirrorSyncResult,
} from './SyncGatewayMirrorUseCase';
import { SyncFxRatesUseCase, type FxRateSyncResult } from './SyncFxRatesUseCase';
import type { IngestExportInboxUseCase, InboxIngestResult } from './IngestExportInboxUseCase';
import type { GatewayCustomerProps } from '@basket/core/entities/GatewayCustomer';
import type { GatewayDisputeProps } from '@basket/core/entities/GatewayDispute';
import type { GatewayPayoutProps } from '@basket/core/entities/GatewayPayout';

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

export interface RunSyncDeps {
  fetcher: ICsvFetcher;
  users: IUserRepository;
  payments: IPaymentRepository;
  teams: ITeamRepository;
  tournaments: ITournamentRepository;
  content: IContentRepository;
  sheets?: ISheetsFetcher;
  sheetRows?: ISheetRowRepository;
  sheetSpecs?: SheetSpec[];
  fixtureMatches?: IFixtureMatchRepository;
  fixtureSpecs?: FixtureSheetSpec[];
  sheetDataMasters?: ISheetDataMasterRepository;
  dataSheetSpecs?: DataSheetSpec[];
  syncState: ISyncStateRepository;
  matViews: IMaterializedViewRepository;
  /** Gateway fee/subscription sync. Omitted, those steps are skipped entirely —
   *  a deploy without gateway credentials still syncs everything else. */
  gatewayFees?: SyncGatewayFeesUseCase;
  gatewaySubscriptions?: SyncGatewaySubscriptionsUseCase;
  /** The three later mirrors — clientes, disputadas, transferencias. Each is
   *  independently optional so a Provider that exposes only some of them, or a
   *  credential scoped to only some of them, still contributes what it has. */
  gatewayCustomers?: SyncGatewayFullMirrorUseCase<GatewayCustomerProps>;
  gatewayDisputes?: SyncGatewayWindowMirrorUseCase<GatewayDisputeProps>;
  gatewayPayouts?: SyncGatewayWindowMirrorUseCase<GatewayPayoutProps>;
  /** Daily FX rates — the blue ARS series plus the derived Stripe rows. Needs
   *  no credential, so it is omitted only to switch the step off. */
  fxRates?: SyncFxRatesUseCase;
  /** Provider Exports that arrive by themselves, in a directory MercadoPago's
   *  report centre writes over SFTP. Omitted — `MP_SFTP_INBOX` unset — the step
   *  is skipped entirely and nothing about the run changes. */
  exportInbox?: IngestExportInboxUseCase;
  /** Overlap for the dispute and payout windows. Longer than the fee overlap by
   *  default: a dispute's evidence window alone is 21 days. */
  gatewayMirrorOverlapDays?: number;
  gatewayMirrorWindowDays?: number;
  /** Days of trailing overlap re-read on each fee sync, so refunds and disputes
   *  that land days after the charge are picked up. */
  gatewayFeeOverlapDays?: number;
  gatewayFeeWindowDays?: number;
  mapUserRow: (row: Record<string, string>, knownTeamIds: Set<number>) => UserProps | null;
  mapPaymentRow: (row: Record<string, string>, knownUserIds: Set<number>) => PaymentProps | null;
  /** Maps one Pagos Export row. Required only when `paymentsRows` is supplied. */
  mapPaymentUploadRow?: (row: PaymentUploadRow, knownUserIds: Set<number>) => PaymentProps | null;
  /** Rows of an Upload. When present, Pagos come from the file and the dead
   *  `/payments` endpoint is not called at all. */
  paymentsRows?: AsyncIterable<PaymentUploadRow>;
  mapTournamentRow: (row: Record<string, string>) => TournamentProps | null;
  mapTeamLiveRow: (row: Record<string, string>) => TeamLiveProps | null;
  mapContentRow: (row: Record<string, string>) => ContentProps | null;
  mapFixtureRow?: (row: Record<string, string>, sourceSheet: string, seasonStartYear?: number) => FixtureMatchProps | null;
  usersResource?: string;
  paymentsResource?: string;
  teamsResource?: string;
  tournamentsResource?: string;
  contentResource?: string;
  contentWindowDays?: number;
  paymentsEnabled?: boolean;
  contentEnabled?: boolean;
  /** Relative window for live payments endpoint (e.g. "-1month", "-2years"). Default "-1month". */
  paymentsWindow?: string;
}

export interface RunSyncResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  syncedUsers: number;
  syncedPayments: number;
  /** Pagos the mapper rejected — unknown Subscriber, unparseable date, bad id. */
  skippedPayments: number;
  syncedTeams: number;
  syncedTournaments: number;
  syncedContent: number;
  syncedSheets: { sheet: string; inserted: number }[];
  syncedFixtures: { sheet: string; inserted: number }[];
  syncedDataMasters: { workbook: string; teams: number; cambios: number; dias: number }[];
  gatewayFees: GatewayFeeSyncResult[];
  gatewaySubscriptions: GatewaySubscriptionSyncResult[];
  /** Customers, disputes and payouts, each tagged with its `mirror` name. */
  gatewayMirrors: GatewayMirrorSyncResult[];
  /** One row per rate source, plus one for the derived Stripe rows. */
  fxRates: FxRateSyncResult[];
  /** Per-file outcomes of the SFTP inbox, or null when that step is off. */
  exportInbox: InboxIngestResult | null;
  /** Pagos realigned to the gateway's amount this run. See docs/adr/0006. */
  correctedAmounts: number;
  refreshes: RefreshResult[];
}

export class RunSyncUseCase {
  constructor(private readonly deps: RunSyncDeps) {}

  async execute(): Promise<RunSyncResult> {
    const startedAt = new Date();
    const usersResource = this.deps.usersResource ?? 'users';
    const paymentsResource = this.deps.paymentsResource ?? 'payments';
    const teamsResource = this.deps.teamsResource ?? 'teams';
    const tournamentsResource = this.deps.tournamentsResource ?? 'tournaments';
    const paymentsEnabled = this.deps.paymentsEnabled !== false;
    const runAt = new Date();

    // 1. Tournaments (no FK deps)
    const tournamentsStream = this.mapTournaments(tournamentsResource);
    const tournamentsResult = await new LoadTournamentsFromCsvUseCase(this.deps.tournaments).execute({
      rows: tournamentsStream,
    });
    await this.deps.syncState.updateLastSync('tournaments', runAt, await this.deps.tournaments.count());

    // 2. Teams (live: id, name, country) — preserves league/tier/type if existing
    const teamsCount = await this.syncTeams(teamsResource);
    await this.deps.syncState.updateLastSync('teams', runAt, await this.deps.teams.count());

    // 3. Users (depend on known team ids)
    const teamIds = await this.deps.teams.getKnownIds();
    const userIdsSeen = new Set<number>();
    const usersStream = this.mapUsers(usersResource, teamIds, userIdsSeen);
    const usersResult = await new LoadUsersFromCsvUseCase(this.deps.users).execute({ rows: usersStream });
    await this.deps.syncState.updateLastSync('users', runAt, await this.deps.users.count());

    // 4. Payments (depend on known user ids); optional.
    // Runs after step 3 either way so `getKnownIds()` reflects this run's Subscribers.
    let paymentsInserted = 0;
    const skipped = { payments: 0 };
    if (paymentsEnabled) {
      const lastPayments = await this.deps.syncState.getLastSync('payments');
      const userIds = await this.deps.users.getKnownIds();
      const paymentsStream = this.deps.paymentsRows
        ? this.mapUploadedPayments(this.deps.paymentsRows, userIds, skipped)
        : this.mapPayments(paymentsResource, lastPayments ?? undefined, userIds, this.deps.paymentsWindow ?? '-1month', skipped);
      const paymentsResult = await new LoadPaymentsFromCsvUseCase(this.deps.payments).execute({ rows: paymentsStream });
      paymentsInserted = paymentsResult.inserted;
      await this.deps.syncState.updateLastSync('payments', runAt, await this.deps.payments.count());
    }

    // 5. Content (windowed)
    let contentInserted = 0;
    if (this.deps.contentEnabled !== false) {
      const windowDays = this.deps.contentWindowDays ?? 30;
      const now = new Date();
      // The endpoint's `to` is exclusive, so asking to=today never returns
      // today's matches. Ask for tomorrow and the tail of the window arrives.
      const to = new Date(now.getTime() + 86400_000);
      const from = new Date(now.getTime() - windowDays * 86400_000);
      const contentResource = this.deps.contentResource ?? 'content';
      const contentStream = this.mapContent(contentResource, from, to);
      const contentResult = await new LoadContentFromCsvUseCase(this.deps.content).execute({ rows: contentStream });
      contentInserted = contentResult.inserted;
      await this.deps.syncState.updateLastSync('content', runAt, await this.deps.content.count());
    }

    // 6. Sheets (optional, run after CSVs so failure here doesn't block)
    const syncedSheets: { sheet: string; inserted: number }[] = [];
    if (this.deps.sheets && this.deps.sheetRows && this.deps.sheetSpecs) {
      const loader = new LoadSheetUseCase(this.deps.sheets, this.deps.sheetRows);
      for (const spec of this.deps.sheetSpecs) {
        try {
          const r = await loader.execute(spec);
          syncedSheets.push({ sheet: spec.sheetName, inserted: r.inserted });
          await this.deps.syncState.updateLastSync(`sheet:${spec.sheetName}`, runAt, r.inserted);
        } catch (err) {
          syncedSheets.push({ sheet: spec.sheetName, inserted: -1 });
          console.error(`sheet ${spec.sheetName} failed:`, (err as Error).message);
        }
      }
    }

    // 6b. Fixture sheets (per-match rows → basket_fixture_matches)
    const syncedFixtures: { sheet: string; inserted: number }[] = [];
    if (
      this.deps.sheets &&
      this.deps.fixtureMatches &&
      this.deps.fixtureSpecs &&
      this.deps.mapFixtureRow
    ) {
      const loader = new LoadFixturesFromSheetUseCase(
        this.deps.sheets,
        this.deps.fixtureMatches,
        this.deps.mapFixtureRow,
      );
      for (const spec of this.deps.fixtureSpecs) {
        try {
          const r = await loader.execute(spec);
          syncedFixtures.push({ sheet: spec.sourceSheet, inserted: r.inserted });
          await this.deps.syncState.updateLastSync(`fixture:${spec.sourceSheet}`, runAt, r.inserted);
        } catch (err) {
          syncedFixtures.push({ sheet: spec.sourceSheet, inserted: -1 });
          console.error(`fixture ${spec.sourceSheet} failed:`, (err as Error).message);
        }
      }
    }

    // 6c. DATA-tab masters (teams roster + cambios/dias enums per workbook)
    const syncedDataMasters: { workbook: string; teams: number; cambios: number; dias: number }[] = [];
    if (this.deps.sheets && this.deps.sheetDataMasters && this.deps.dataSheetSpecs) {
      const loader = new LoadSheetDataMastersUseCase(this.deps.sheets, this.deps.sheetDataMasters);
      for (const spec of this.deps.dataSheetSpecs) {
        try {
          const r = await loader.execute(spec);
          syncedDataMasters.push({ workbook: spec.workbookLabel, ...r });
          await this.deps.syncState.updateLastSync(`data:${spec.workbookLabel}`, runAt, r.teams + r.cambios + r.dias);
        } catch (err) {
          syncedDataMasters.push({ workbook: spec.workbookLabel, teams: -1, cambios: -1, dias: -1 });
          console.error(`data ${spec.workbookLabel} failed:`, (err as Error).message);
        }
      }
    }

    // 7. Gateway fees — delta only. The use case resumes from its own watermark
    // minus an overlap, so a 6-hourly cron reads hours of ledger, not years.
    // Never fatal: a gateway outage must not cost us the Pagos sync that already
    // succeeded, so failures are recorded in the result and the run continues.
    let gatewayFees: GatewayFeeSyncResult[] = [];
    if (this.deps.gatewayFees) {
      try {
        gatewayFees = await this.deps.gatewayFees.execute({
          overlapDays: this.deps.gatewayFeeOverlapDays,
          windowDays: this.deps.gatewayFeeWindowDays,
        });
      } catch (err) {
        console.error('gateway fee sync failed:', (err as Error).message);
      }
    }

    // 8. Gateway subscriptions — full refresh, not a window. A cancellation is
    // an update to an object created long ago, so there is no delta to read.
    let gatewaySubscriptions: GatewaySubscriptionSyncResult[] = [];
    if (this.deps.gatewaySubscriptions) {
      try {
        gatewaySubscriptions = await this.deps.gatewaySubscriptions.execute();
      } catch (err) {
        console.error('gateway subscription sync failed:', (err as Error).message);
      }
    }

    // 8b. The three later mirrors. Same never-fatal contract as the two above:
    // each is caught on its own, so a credential scoped without dispute access
    // costs the disputes and nothing else.
    //
    // Customers run before disputes and payouts only because they are the
    // slowest and the most likely to be interrupted; nothing here depends on
    // anything else here.
    const gatewayMirrors: GatewayMirrorSyncResult[] = [];
    const mirrorWindow = {
      overlapDays: this.deps.gatewayMirrorOverlapDays,
      windowDays: this.deps.gatewayMirrorWindowDays,
    };
    const runMirror = async (label: string, run: () => Promise<GatewayMirrorSyncResult[]>) => {
      try {
        gatewayMirrors.push(...(await run()));
      } catch (err) {
        console.error(`gateway ${label} sync failed:`, (err as Error).message);
      }
    };
    if (this.deps.gatewayCustomers) {
      await runMirror('customer', () => this.deps.gatewayCustomers!.execute());
    }
    if (this.deps.gatewayDisputes) {
      await runMirror('dispute', () => this.deps.gatewayDisputes!.execute(mirrorWindow));
    }
    if (this.deps.gatewayPayouts) {
      await runMirror('payout', () => this.deps.gatewayPayouts!.execute(mirrorWindow));
    }

    // 8c. FX rates. After the fee sync because the derived Stripe rows are read
    // out of the fee mirror, so running it first would name a rate from before
    // this run's charges landed. Never fatal, like every step above it: a
    // dolarapi outage must not cost the Pagos sync that already succeeded.
    let fxRates: FxRateSyncResult[] = [];
    if (this.deps.fxRates) {
      try {
        fxRates = await this.deps.fxRates.execute();
        for (const r of fxRates) {
          if (r.error) console.error(`fx ${r.source} failed: ${r.error}`);
        }
      } catch (err) {
        console.error('fx rate sync failed:', (err as Error).message);
      }
    }

    // 8d. Provider Exports waiting in the SFTP inbox. Before the reconciliation
    // below, which reads the fee mirror as truth, and before the view refresh,
    // which is the only thing that makes these rows visible. Never fatal, and
    // never fatal per *file* too: the use case isolates each one, so a malformed
    // Export costs that Export and nothing else.
    let exportInbox: InboxIngestResult | null = null;
    if (this.deps.exportInbox) {
      try {
        exportInbox = await this.deps.exportInbox.execute();
        if (exportInbox.error) console.error(`export inbox failed: ${exportInbox.error}`);
        for (const f of exportInbox.files) {
          if (f.outcome === 'ingested') {
            console.log(`inbox ${f.filename}: ${f.rows} rows, ${f.upserted} upserted`);
          } else if (f.outcome !== 'skipped') {
            console.error(`inbox ${f.filename} ${f.outcome}: ${f.error}`);
          }
        }
      } catch (err) {
        console.error('export inbox sync failed:', (err as Error).message);
      }
    }

    // 9. Realign Pago amounts against the gateway. Must come AFTER the fee sync
    // (it reads fees as truth) and BEFORE the mat view refresh (amount feeds
    // tier classification, so a correction changes sub_type).
    let correctedAmounts = 0;
    try {
      const reconciled = await new ReconcilePaymentAmountsUseCase(this.deps.payments).execute();
      correctedAmounts = reconciled.corrected;
      if (correctedAmounts > 0) {
        console.log(`realigned ${correctedAmounts} Pago amounts to the gateway`);
      }
    } catch (err) {
      console.error('amount reconciliation failed:', (err as Error).message);
    }

    // 10. Refresh mat views
    const refreshes = await new RefreshMaterializedViewsUseCase(this.deps.matViews).execute({ concurrent: true });

    const finishedAt = new Date();
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      syncedUsers: usersResult.inserted,
      syncedPayments: paymentsInserted,
      skippedPayments: skipped.payments,
      syncedTeams: teamsCount,
      syncedTournaments: tournamentsResult.inserted,
      syncedContent: contentInserted,
      syncedSheets,
      syncedFixtures,
      syncedDataMasters,
      gatewayFees,
      gatewaySubscriptions,
      gatewayMirrors,
      fxRates,
      exportInbox,
      correctedAmounts,
      refreshes,
    };
  }

  private async *mapContent(resource: string, from: Date, to: Date): AsyncGenerator<ContentProps> {
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const extraParams = { from: ymd(from), to: ymd(to) };
    for await (const row of this.deps.fetcher.streamRows<Record<string, string>>(resource, { extraParams })) {
      const mapped = this.deps.mapContentRow(row);
      if (mapped) yield mapped;
    }
  }

  private async syncTeams(resource: string): Promise<number> {
    const batch: TeamLiveProps[] = [];
    for await (const row of this.deps.fetcher.streamRows<Record<string, string>>(resource)) {
      const mapped = this.deps.mapTeamLiveRow(row);
      if (mapped) batch.push(mapped);
    }
    if (batch.length === 0) return 0;
    return this.deps.teams.upsertManyFromLive(batch);
  }

  private async *mapTournaments(resource: string): AsyncGenerator<TournamentProps> {
    for await (const row of this.deps.fetcher.streamRows<Record<string, string>>(resource)) {
      const mapped = this.deps.mapTournamentRow(row);
      if (mapped) yield mapped;
    }
  }

  private async *mapUsers(
    resource: string,
    teamIds: Set<number>,
    seen: Set<number>,
  ): AsyncGenerator<UserProps> {
    for await (const row of this.deps.fetcher.streamRows<Record<string, string>>(resource)) {
      const mapped = this.deps.mapUserRow(row, teamIds);
      if (mapped) {
        seen.add(mapped.id);
        yield mapped;
      }
    }
  }

  private async *mapUploadedPayments(
    rows: AsyncIterable<PaymentUploadRow>,
    userIds: Set<number>,
    skipped: { payments: number },
  ): AsyncGenerator<PaymentProps> {
    const map = this.deps.mapPaymentUploadRow;
    if (!map) throw new Error('paymentsRows requires mapPaymentUploadRow');
    for await (const row of rows) {
      const mapped = map(row, userIds);
      if (mapped) yield mapped;
      else skipped.payments += 1;
    }
  }

  private async *mapPayments(
    resource: string,
    _since: Date | undefined,
    userIds: Set<number>,
    window: string,
    skipped: { payments: number },
  ): AsyncGenerator<PaymentProps> {
    // `/payments` requires Control Panel session cookie (BP_SESSION_COOKIE).
    // Upsert idempotent via PK so rolling window stays cheap.
    let rowsSeen = 0;
    try {
      for await (const row of this.deps.fetcher.streamRows<Record<string, string>>(resource, {
        omitSince: true,
        extraParams: { from: window },
      })) {
        rowsSeen += 1;
        const mapped = this.deps.mapPaymentRow(row, userIds);
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
}
