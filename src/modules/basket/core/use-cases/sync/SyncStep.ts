// A Sync is an ordered list of steps and one loop. Each step says what it is
// called, what happens when it throws, and what it must run after. The runner
// (RunSyncUseCase) knows nothing else about it.
//
// Three failure policies exist because three already existed as control flow:
//
//   fatal        the run stops here and the error propagates. Earlier steps have
//                already advanced their watermarks — deliberately, so an operator
//                reading basket_sync_state sees "users fresh, payments stale".
//   never-fatal  the failure is logged, recorded on the result, and the run goes
//                on. A Provider outage must not cost the Pagos sync that already
//                succeeded (docs/handoff/alert-when-a-gateway-sync-fails.md).
//   per-item     the step is a list of independent items (Sheets specs). One bad
//                item costs that item only, and contributes its own failure
//                marker to the result — the `-1` the Data Quality tab reads.
//
// A step that owns a `basket_sync_state` watermark advances it inside `run`, and
// only on success — the rule ADR 0006 states for fees applies to every step.

import type { RefreshResult } from '@basket/core/ports/IMaterializedViewRepository';
import type { GatewayFeeSyncResult } from './SyncGatewayFeesUseCase';
import type { GatewaySubscriptionSyncResult } from './SyncGatewaySubscriptionsUseCase';
import type { GatewayMirrorSyncResult } from './SyncGatewayMirrorUseCase';
import type { FxRateSyncResult } from './SyncFxRatesUseCase';
import type { InboxIngestResult } from './IngestExportInboxUseCase';

/** What the steps produce between them. Arrays concatenate, numbers add,
 *  anything else is replaced by the later contribution. */
export interface SyncContribution {
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

export type StepContribution = Partial<SyncContribution>;

export function emptyContribution(): SyncContribution {
  return {
    syncedUsers: 0,
    syncedPayments: 0,
    skippedPayments: 0,
    syncedTeams: 0,
    syncedTournaments: 0,
    syncedContent: 0,
    syncedSheets: [],
    syncedFixtures: [],
    syncedDataMasters: [],
    gatewayFees: [],
    gatewaySubscriptions: [],
    gatewayMirrors: [],
    fxRates: [],
    exportInbox: null,
    correctedAmounts: 0,
    refreshes: [],
  };
}

export function foldContribution(acc: SyncContribution, part: StepContribution): SyncContribution {
  const out = { ...acc } as Record<string, unknown>;
  for (const [key, value] of Object.entries(part)) {
    if (value === undefined) continue;
    const prev = out[key];
    if (Array.isArray(prev) && Array.isArray(value)) out[key] = [...prev, ...value];
    else if (typeof prev === 'number' && typeof value === 'number') out[key] = prev + value;
    else out[key] = value;
  }
  return out as unknown as SyncContribution;
}

/** Shared by every step of one run: the one timestamp every watermark records. */
export interface SyncRunContext {
  runAt: Date;
}

export type SyncStepPolicy = 'fatal' | 'never-fatal' | 'per-item';

interface SyncStepBase {
  /** Stable name. Scope filters and `after` refer to it; failures are recorded under it. */
  name: string;
  /** Names of steps this one must follow when they are present. Checked by the
   *  runner at construction, so a wrongly ordered list fails before it runs. */
  after?: readonly string[];
}

export interface FatalStep extends SyncStepBase {
  policy: 'fatal';
  run(ctx: SyncRunContext): Promise<StepContribution>;
}

export interface NeverFatalStep extends SyncStepBase {
  policy: 'never-fatal';
  run(ctx: SyncRunContext): Promise<StepContribution>;
}

export interface PerItemStep<I = unknown> extends SyncStepBase {
  policy: 'per-item';
  items: readonly I[];
  /** Method syntax on purpose: it keeps `PerItemStep<SheetSpec>` assignable to `SyncStep`. */
  itemName(item: I): string;
  runItem(item: I, ctx: SyncRunContext): Promise<StepContribution>;
  /** What the result records for an item that threw. */
  failedItem(item: I): StepContribution;
}

export type SyncStep = FatalStep | NeverFatalStep | PerItemStep;

export interface SyncStepFailure {
  step: string;
  item?: string;
  error: string;
}

/**
 * Names must be unique, and every `after` that names a step present in the list
 * must name one that comes earlier. An `after` naming an absent step is fine —
 * fees are optional, and reconciliation still runs without them.
 */
export function assertStepOrder(steps: readonly SyncStep[]): void {
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.name)) throw new Error(`sync step '${step.name}' is listed twice`);
    const all = new Set(steps.map((s) => s.name));
    for (const dep of step.after ?? []) {
      if (all.has(dep) && !seen.has(dep)) {
        throw new Error(`sync step '${step.name}' must run after '${dep}'`);
      }
    }
    seen.add(step.name);
  }
}
