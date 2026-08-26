import type {
  GatewayFullSource,
  GatewayWindowSource,
  IGatewayMirrorRepository,
  MirrorWindow,
} from '@basket/core/ports/IGatewayMirror';
import type { ISyncStateRepository } from '@basket/core/ports/ISyncStateRepository';
import { slice } from './SyncGatewayFeesUseCase';

const DEFAULT_WINDOW_DAYS = 30;
const UPSERT_FLUSH_SIZE = 500;

/**
 * A dispute is opened days after the charge and then changes status for weeks;
 * a payout moves from `pending` to `in_transit` to `paid` over several days. So,
 * as with fees, an incremental run cannot start where the last one ended.
 * Disputes are the slowest of the three — Stripe's evidence window alone is 21
 * days — so the default overlap is longer than the fee sync's fortnight.
 */
const DEFAULT_OVERLAP_DAYS = 30;

export interface GatewayMirrorSyncResult {
  slug: string;
  platform: number;
  mirror: string;
  from: string;
  to: string;
  fetched: number;
  upserted: number;
  windows: number;
  durationMs: number;
  error?: string;
}

export interface SyncGatewayMirrorInput {
  /** Explicit floor. Backfill passes it; the cron omits it and resumes. */
  from?: Date;
  to?: Date;
  windowDays?: number;
  overlapDays?: number;
  onProgress?: (progress: { slug: string; window: MirrorWindow; fetched: number }) => void;
}

/**
 * Reads a windowed mirror — disputes, payouts — from every configured Provider.
 *
 * Same watermark contract as `SyncGatewayFeesUseCase`, and for the same reasons:
 * only a clean run advances it, and a Provider with no watermark at all fails
 * loudly instead of quietly reading the last month and leaving years empty.
 *
 * `mirror` is the sync-state key prefix (`disputes`, `payouts`), so each mirror
 * resumes on its own clock. Sharing one watermark across mirrors would mean a
 * dispute sync that failed silently rolled the payout sync forward past its gap.
 */
export class SyncGatewayWindowMirrorUseCase<T> {
  constructor(
    private readonly mirror: string,
    private readonly sources: GatewayWindowSource<T>[],
    private readonly repository: IGatewayMirrorRepository<T>,
    private readonly syncState: ISyncStateRepository,
  ) {}

  async execute(input: SyncGatewayMirrorInput = {}): Promise<GatewayMirrorSyncResult[]> {
    const results: GatewayMirrorSyncResult[] = [];
    for (const source of this.sources) results.push(await this.syncOne(source, input));
    return results;
  }

  private async syncOne(
    source: GatewayWindowSource<T>,
    input: SyncGatewayMirrorInput,
  ): Promise<GatewayMirrorSyncResult> {
    const startedAt = Date.now();
    const stateKey = `${this.mirror}:${source.slug}`;
    const to = input.to ?? new Date();
    const base = {
      slug: source.slug,
      platform: source.platform,
      mirror: this.mirror,
      to: to.toISOString(),
    };

    let from: Date;
    try {
      from = input.from ?? (await this.resumePoint(stateKey, input.overlapDays));
    } catch (err) {
      return {
        ...base,
        from: '',
        fetched: 0,
        upserted: 0,
        windows: 0,
        durationMs: Date.now() - startedAt,
        error: message(err),
      };
    }

    let fetched = 0;
    let upserted = 0;
    let windows = 0;
    let buffer: T[] = [];

    const flush = async () => {
      if (buffer.length === 0) return;
      upserted += await this.repository.upsertMany(buffer);
      buffer = [];
    };

    try {
      for (const window of slice(from, to, input.windowDays ?? DEFAULT_WINDOW_DAYS)) {
        windows += 1;
        const before = fetched;
        for await (const row of source.stream(window)) {
          buffer.push(row);
          fetched += 1;
          if (buffer.length >= UPSERT_FLUSH_SIZE) await flush();
        }
        // Per window, not once at the end: a crashed backfill keeps everything
        // committed before the window that failed.
        await flush();
        input.onProgress?.({ slug: source.slug, window, fetched: fetched - before });
      }
    } catch (err) {
      await flush();
      return {
        ...base,
        from: from.toISOString(),
        fetched,
        upserted,
        windows,
        durationMs: Date.now() - startedAt,
        error: message(err),
      };
    }

    await this.syncState.updateLastSync(stateKey, to, upserted);

    return {
      ...base,
      from: from.toISOString(),
      fetched,
      upserted,
      windows,
      durationMs: Date.now() - startedAt,
    };
  }

  private async resumePoint(stateKey: string, overlapDays?: number): Promise<Date> {
    const last = await this.syncState.getLastSync(stateKey);
    if (last) return new Date(last.getTime() - (overlapDays ?? DEFAULT_OVERLAP_DAYS) * 86_400_000);
    throw new Error(
      `${stateKey} has no watermark — run the backfill with an explicit --from first`,
    );
  }
}

/**
 * Reads a full mirror — customers — from every configured Provider.
 *
 * No window and no watermark to resume from, because there is nothing to resume:
 * the correct read is always "all of it". The watermark is still written, purely
 * so an operator can see when the mirror was last known good.
 */
export class SyncGatewayFullMirrorUseCase<T> {
  constructor(
    private readonly mirror: string,
    private readonly sources: GatewayFullSource<T>[],
    private readonly repository: IGatewayMirrorRepository<T>,
    private readonly syncState: ISyncStateRepository,
  ) {}

  async execute(): Promise<GatewayMirrorSyncResult[]> {
    const results: GatewayMirrorSyncResult[] = [];
    for (const source of this.sources) results.push(await this.syncOne(source));
    return results;
  }

  private async syncOne(source: GatewayFullSource<T>): Promise<GatewayMirrorSyncResult> {
    const startedAt = Date.now();
    const runAt = new Date();
    let fetched = 0;
    let upserted = 0;
    let buffer: T[] = [];

    const flush = async () => {
      if (buffer.length === 0) return;
      upserted += await this.repository.upsertMany(buffer);
      buffer = [];
    };

    const base = {
      slug: source.slug,
      platform: source.platform,
      mirror: this.mirror,
      from: '',
      to: runAt.toISOString(),
      windows: 1,
    };

    try {
      for await (const row of source.stream()) {
        buffer.push(row);
        fetched += 1;
        if (buffer.length >= UPSERT_FLUSH_SIZE) await flush();
      }
      await flush();
    } catch (err) {
      await flush();
      return { ...base, fetched, upserted, durationMs: Date.now() - startedAt, error: message(err) };
    }

    await this.syncState.updateLastSync(`${this.mirror}:${source.slug}`, runAt, upserted);

    return { ...base, fetched, upserted, durationMs: Date.now() - startedAt };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
