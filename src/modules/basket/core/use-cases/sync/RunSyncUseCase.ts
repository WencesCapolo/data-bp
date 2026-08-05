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
  mapUserRow: (row: Record<string, string>, knownTeamIds: Set<number>) => UserProps | null;
  mapPaymentRow: (row: Record<string, string>, knownUserIds: Set<number>) => PaymentProps | null;
  /** Maps one Cobros Export row. Required only when `paymentsRows` is supplied. */
  mapPaymentUploadRow?: (row: PaymentUploadRow, knownUserIds: Set<number>) => PaymentProps | null;
  /** Rows of an Upload. When present, Cobros come from the file and the dead
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
  /** Cobros the mapper rejected — unknown Subscriber, unparseable date, bad id. */
  skippedPayments: number;
  syncedTeams: number;
  syncedTournaments: number;
  syncedContent: number;
  syncedSheets: { sheet: string; inserted: number }[];
  syncedFixtures: { sheet: string; inserted: number }[];
  syncedDataMasters: { workbook: string; teams: number; cambios: number; dias: number }[];
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
      const to = new Date();
      const from = new Date(to.getTime() - windowDays * 86400_000);
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

    // 7. Refresh mat views
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
    // instead of recording a Sync that quietly wrote no Cobros.
    if (rowsSeen === 0) {
      throw new Error('Expiró la Cookie: /payments respondió sin filas CSV');
    }
  }
}
