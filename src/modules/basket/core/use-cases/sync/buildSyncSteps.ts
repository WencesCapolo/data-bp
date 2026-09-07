// The list. One ordered list of steps for a full Sync; a scope is a filter over
// it. Adding a source is one factory in syncSteps.ts and one line here.
//
// Nothing in this file touches the environment or discovers anything: the
// composer (infrastructure/sync/composeRunSync.ts) does that and hands a
// finished SyncSources in. That is what makes the list testable without a
// database — see buildSyncSteps.test.ts.

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
import type { TournamentProps } from '@basket/core/entities/Tournament';
import type { ContentProps } from '@basket/core/entities/Content';
import type { FixtureMatchProps } from '@basket/core/entities/FixtureMatch';
import type { GatewayCustomerProps } from '@basket/core/entities/GatewayCustomer';
import type { GatewayDisputeProps } from '@basket/core/entities/GatewayDispute';
import type { GatewayPayoutProps } from '@basket/core/entities/GatewayPayout';
import type { SyncGatewayFeesUseCase } from './SyncGatewayFeesUseCase';
import type { SyncGatewaySubscriptionsUseCase } from './SyncGatewaySubscriptionsUseCase';
import type { SyncGatewayFullMirrorUseCase, SyncGatewayWindowMirrorUseCase } from './SyncGatewayMirrorUseCase';
import type { SyncFxRatesUseCase } from './SyncFxRatesUseCase';
import type { IngestExportInboxUseCase } from './IngestExportInboxUseCase';
import type { SyncStep } from './SyncStep';
import {
  STEP,
  contentStep,
  customersStep,
  dataMastersStep,
  disputesStep,
  exportInboxStep,
  feesStep,
  fixturesStep,
  fxRatesStep,
  paymentsStep,
  payoutsStep,
  reconcileStep,
  refreshStep,
  sheetsStep,
  subscriptionsStep,
  teamsStep,
  tournamentsStep,
  usersStep,
  type DataSheetSpec,
  type FixtureSheetSpec,
  type MirrorWindow,
  type PaymentsSource,
  type SheetSpec,
} from './syncSteps';

/** `full` is every step below. `upload` is the Sync button's run: the Pagos
 *  Export, the amount realignment and the view refresh — a person should never
 *  wait on Stripe. */
export type SyncScope = 'full' | 'upload';

export const UPLOAD_STEPS: readonly string[] = [STEP.payments, STEP.reconcile, STEP.refresh];

type CsvRow = Record<string, string>;

/**
 * Everything a full Sync reads from and writes to, already constructed. An
 * optional group left out switches its step off; nothing about the run changes.
 */
export interface SyncSources {
  fetcher: ICsvFetcher;
  syncState: ISyncStateRepository;
  matViews: IMaterializedViewRepository;
  tournaments: { repo: ITournamentRepository; resource: string; mapRow: (row: CsvRow) => TournamentProps | null };
  teams: { repo: ITeamRepository; resource: string; mapRow: (row: CsvRow) => TeamLiveProps | null };
  users: {
    repo: IUserRepository;
    resource: string;
    mapRow: (row: CsvRow, knownTeamIds: Set<number>) => UserProps | null;
  };
  /** `source: null` switches the step off — the dead `/payments` endpoint is not
   *  called and no Upload is being consumed. */
  payments: { repo: IPaymentRepository; source: PaymentsSource | null };
  content?: {
    repo: IContentRepository;
    resource: string;
    windowDays: number;
    mapRow: (row: CsvRow) => ContentProps | null;
  };
  sheets?: {
    fetcher: ISheetsFetcher;
    rows?: { repo: ISheetRowRepository; specs: readonly SheetSpec[] };
    fixtures?: {
      repo: IFixtureMatchRepository;
      specs: readonly FixtureSheetSpec[];
      mapRow: (row: CsvRow, sourceSheet: string, seasonStartYear?: number) => FixtureMatchProps | null;
    };
    dataMasters?: { repo: ISheetDataMasterRepository; specs: readonly DataSheetSpec[] };
  };
  /** Each Provider mirror is independently optional so a credential scoped to
   *  only some of them still contributes what it has. */
  gateways?: {
    fees?: { useCase: SyncGatewayFeesUseCase; overlapDays: number; windowDays: number };
    subscriptions?: SyncGatewaySubscriptionsUseCase;
    customers?: SyncGatewayFullMirrorUseCase<GatewayCustomerProps>;
    disputes?: SyncGatewayWindowMirrorUseCase<GatewayDisputeProps>;
    payouts?: SyncGatewayWindowMirrorUseCase<GatewayPayoutProps>;
    /** Wider than the fee window: disputes and payouts are sparse. */
    mirrorWindow: MirrorWindow;
  };
  fxRates?: SyncFxRatesUseCase;
  exportInbox?: IngestExportInboxUseCase;
}

export function buildSyncSteps(s: SyncSources, scope: SyncScope = 'full'): SyncStep[] {
  if (scope === 'upload' && s.payments.source?.kind !== 'upload') {
    throw new Error("scope 'upload' requires a Pagos Export as the payments source");
  }

  const { fetcher, syncState } = s;
  const g = s.gateways;
  const sh = s.sheets;

  const full: (SyncStep | null)[] = [
    // 1–3. Masters.
    tournamentsStep({ fetcher, syncState, ...s.tournaments }),
    teamsStep({ fetcher, syncState, ...s.teams }),
    usersStep({ fetcher, syncState, teams: s.teams.repo, ...s.users }),
    // 4. Pagos.
    s.payments.source
      ? paymentsStep({ source: s.payments.source, repo: s.payments.repo, users: s.users.repo, syncState })
      : null,
    // 5. Content.
    s.content ? contentStep({ fetcher, syncState, ...s.content }) : null,
    // 6. Sheets, after the CSVs so a Sheets failure cannot block them.
    sh?.rows ? sheetsStep({ sheets: sh.fetcher, syncState, ...sh.rows }) : null,
    sh?.fixtures ? fixturesStep({ sheets: sh.fetcher, syncState, ...sh.fixtures }) : null,
    sh?.dataMasters ? dataMastersStep({ sheets: sh.fetcher, syncState, ...sh.dataMasters }) : null,
    // 7–8. Providers (ADR 0006). Customers before disputes and payouts only
    // because they are the slowest and the most likely to be interrupted.
    g?.fees ? feesStep(g.fees) : null,
    g?.subscriptions ? subscriptionsStep({ useCase: g.subscriptions }) : null,
    g?.customers ? customersStep({ useCase: g.customers }) : null,
    g?.disputes ? disputesStep({ useCase: g.disputes, window: g.mirrorWindow }) : null,
    g?.payouts ? payoutsStep({ useCase: g.payouts, window: g.mirrorWindow }) : null,
    s.fxRates ? fxRatesStep({ useCase: s.fxRates }) : null,
    s.exportInbox ? exportInboxStep({ useCase: s.exportInbox }) : null,
    // 9–10.
    reconcileStep({ repo: s.payments.repo }),
    refreshStep({ matViews: s.matViews }),
  ];

  const steps = full.filter((x): x is SyncStep => x !== null);
  return scope === 'upload' ? steps.filter((x) => UPLOAD_STEPS.includes(x.name)) : steps;
}
