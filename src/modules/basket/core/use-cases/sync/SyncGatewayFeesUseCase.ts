import type { GatewayFeeProps } from '@basket/core/entities/GatewayFee';
import type { FeeWindow, IGatewayFeeFetcher } from '@basket/core/ports/IGatewayFeeFetcher';
import type { IGatewayFeeRepository } from '@basket/core/ports/IGatewayFeeRepository';
import type { ISyncStateRepository } from '@basket/core/ports/ISyncStateRepository';

const DEFAULT_WINDOW_DAYS = 7;
const UPSERT_FLUSH_SIZE = 500;

/**
 * A refund, chargeback or dispute lands on a transaction days after it was
 * charged, and it changes that transaction's row — not a new one. An incremental
 * run therefore cannot start where the last one ended: it has to re-read the
 * recent past. Two weeks covers Stripe's refund window and MercadoPago's
 * mediation window with room to spare.
 */
const DEFAULT_OVERLAP_DAYS = 14;

export interface SyncGatewayFeesInput {
  /** Explicit floor. Backfill passes the first Pago's date; incremental omits it. */
  from?: Date;
  to?: Date;
  /** Slice size handed to fetchers. Smaller slices mean more requests but a
   *  cheaper retry when one fails. */
  windowDays?: number;
  overlapDays?: number;
  onProgress?: (progress: FeeSyncProgress) => void;
}

export interface FeeSyncProgress {
  slug: string;
  window: FeeWindow;
  fetched: number;
  upserted: number;
}

export interface GatewayFeeSyncResult {
  slug: string;
  platform: number;
  from: string;
  to: string;
  fetched: number;
  upserted: number;
  windows: number;
  durationMs: number;
  error?: string;
}

export class SyncGatewayFeesUseCase {
  constructor(
    private readonly fetchers: IGatewayFeeFetcher[],
    private readonly fees: IGatewayFeeRepository,
    private readonly syncState: ISyncStateRepository,
  ) {}

  async execute(input: SyncGatewayFeesInput = {}): Promise<GatewayFeeSyncResult[]> {
    const results: GatewayFeeSyncResult[] = [];
    for (const fetcher of this.fetchers) {
      results.push(await this.syncOne(fetcher, input));
    }
    return results;
  }

  private async syncOne(
    fetcher: IGatewayFeeFetcher,
    input: SyncGatewayFeesInput,
  ): Promise<GatewayFeeSyncResult> {
    const startedAt = Date.now();
    const stateKey = `fees:${fetcher.slug}`;
    const to = input.to ?? new Date();

    let from: Date;
    try {
      from = input.from ?? (await this.resumePoint(stateKey, input.overlapDays));
    } catch (err) {
      // A gateway with no watermark yet (never backfilled) must not abort the
      // gateways that do have one. Report it as this gateway's failure and let
      // the caller carry on.
      return {
        slug: fetcher.slug,
        platform: fetcher.platform,
        from: '',
        to: to.toISOString(),
        fetched: 0,
        upserted: 0,
        windows: 0,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    let fetched = 0;
    let upserted = 0;
    let windows = 0;
    let buffer: GatewayFeeProps[] = [];

    const flush = async () => {
      if (buffer.length === 0) return;
      upserted += await this.fees.upsertMany(buffer);
      buffer = [];
    };

    try {
      for (const window of slice(from, to, input.windowDays ?? DEFAULT_WINDOW_DAYS)) {
        windows += 1;
        const before = fetched;
        for await (const record of fetcher.streamFees(window)) {
          buffer.push(record);
          fetched += 1;
          if (buffer.length >= UPSERT_FLUSH_SIZE) await flush();
        }
        // Flushing per window, not once at the end, is what makes a crashed
        // backfill resumable: everything before the failing window is committed.
        await flush();
        input.onProgress?.({ slug: fetcher.slug, window, fetched: fetched - before, upserted });
      }
    } catch (err) {
      await flush();
      return {
        slug: fetcher.slug,
        platform: fetcher.platform,
        from: from.toISOString(),
        to: to.toISOString(),
        fetched,
        upserted,
        windows,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Only a clean run advances the watermark. A partial run that recorded `to`
    // would make the gap it left invisible to every later incremental run.
    await this.syncState.updateLastSync(stateKey, to, upserted);

    return {
      slug: fetcher.slug,
      platform: fetcher.platform,
      from: from.toISOString(),
      to: to.toISOString(),
      fetched,
      upserted,
      windows,
      durationMs: Date.now() - startedAt,
    };
  }

  private async resumePoint(stateKey: string, overlapDays?: number): Promise<Date> {
    const last = await this.syncState.getLastSync(stateKey);
    const overlap = (overlapDays ?? DEFAULT_OVERLAP_DAYS) * 86_400_000;
    if (last) return new Date(last.getTime() - overlap);
    // No watermark means nobody has ever backfilled this gateway. Reading the
    // last two weeks would look like success while leaving years empty, so
    // refuse and make the caller state the range.
    throw new Error(
      `${stateKey} has no watermark — run the backfill with an explicit --from first`,
    );
  }
}

/** Half-open windows, so no transaction is fetched by two of them. */
export function slice(from: Date, to: Date, days: number): FeeWindow[] {
  if (days <= 0) throw new Error('windowDays must be positive');
  const step = days * 86_400_000;
  const windows: FeeWindow[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += step) {
    windows.push({ from: new Date(t), to: new Date(Math.min(t + step, to.getTime())) });
  }
  return windows;
}
