import type { IFxRateRepository, IFxRateSource } from '@basket/core/ports/IFxRate';
import type { ISyncStateRepository } from '@basket/core/ports/ISyncStateRepository';

/**
 * How far back a resumed run re-reads. A published blue rate is not revised, so
 * this is short — it exists because the history endpoint lags the spot by a day
 * and the previous run may have stored a day it had only the spot for.
 */
const DEFAULT_OVERLAP_DAYS = 7;

export interface FxRateSyncResult {
  source: string;
  pair: string;
  since: string | null;
  fetched: number;
  upserted: number;
  durationMs: number;
  error?: string;
}

export interface SyncFxRatesInput {
  /** Floor, YYYY-MM-DD. The backfill passes it; the cron resumes instead. */
  since?: string;
  overlapDays?: number;
  /** Skip the derived Stripe rows — the backfill wants them, a dry run may not. */
  deriveStripe?: boolean;
}

/**
 * Fills basket_fx_rates.
 *
 * Not a `SyncGatewayWindowMirrorUseCase`, and the difference is the data's, not
 * a preference: the blue history endpoint takes no parameters and answers with
 * every day it has, so there is no window to slice and no page to walk. What is
 * left of the mirror contract — resume from a watermark, only advance it on a
 * clean run, never be fatal to the sync around it — is kept.
 *
 * The derived Stripe rows are refreshed in the same step because they are read
 * from the fee mirror rather than fetched, and leaving them to their own step
 * would let a converted Stripe figure name a rate from before the last fee sync.
 */
export class SyncFxRatesUseCase {
  constructor(
    private readonly sources: IFxRateSource[],
    private readonly repository: IFxRateRepository,
    private readonly syncState: ISyncStateRepository,
  ) {}

  async execute(input: SyncFxRatesInput = {}): Promise<FxRateSyncResult[]> {
    const results: FxRateSyncResult[] = [];
    for (const source of this.sources) results.push(await this.syncOne(source, input));

    if (input.deriveStripe !== false) {
      const startedAt = Date.now();
      try {
        const upserted = await this.repository.refreshDerivedStripeRates();
        results.push({
          source: 'stripe',
          pair: 'derived from basket_payment_fees',
          since: null,
          fetched: upserted,
          upserted,
          durationMs: Date.now() - startedAt,
        });
      } catch (err) {
        results.push({
          source: 'stripe',
          pair: 'derived from basket_payment_fees',
          since: null,
          fetched: 0,
          upserted: 0,
          durationMs: Date.now() - startedAt,
          error: message(err),
        });
      }
    }

    return results;
  }

  private async syncOne(source: IFxRateSource, input: SyncFxRatesInput): Promise<FxRateSyncResult> {
    const startedAt = Date.now();
    const stateKey = `fx:${source.source}`;
    const base = {
      source: source.source,
      pair: `${source.baseCurrency}→${source.quoteCurrency}`,
    };

    // No watermark and no explicit floor means the first run, which must read
    // the whole history: a rate table that starts a month ago converts every
    // older Pago at a rate it does not have. So the fallback is "everything",
    // the opposite of the mirrors' — where reading everything is expensive and
    // an absent watermark is an error.
    const since = input.since ?? (await this.resumePoint(stateKey, input.overlapDays));

    try {
      const rates = await source.fetch(since ?? undefined);
      const upserted = await this.repository.upsertMany(rates);
      const runAt = new Date();
      await this.syncState.updateLastSync(stateKey, runAt, upserted);
      return {
        ...base,
        since,
        fetched: rates.length,
        upserted,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      return {
        ...base,
        since,
        fetched: 0,
        upserted: 0,
        durationMs: Date.now() - startedAt,
        error: message(err),
      };
    }
  }

  private async resumePoint(stateKey: string, overlapDays?: number): Promise<string | null> {
    const last = await this.syncState.getLastSync(stateKey);
    if (!last) return null;
    const floor = new Date(last.getTime() - (overlapDays ?? DEFAULT_OVERLAP_DAYS) * 86_400_000);
    return floor.toISOString().slice(0, 10);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
