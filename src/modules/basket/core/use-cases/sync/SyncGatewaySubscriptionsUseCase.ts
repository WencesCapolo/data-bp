import type { GatewaySubscriptionProps } from '@basket/core/entities/GatewaySubscription';
import type { IGatewaySubscriptionFetcher } from '@basket/core/ports/IGatewaySubscriptionFetcher';
import type { IGatewaySubscriptionRepository } from '@basket/core/ports/IGatewaySubscriptionRepository';
import type { ISyncStateRepository } from '@basket/core/ports/ISyncStateRepository';

const UPSERT_FLUSH_SIZE = 500;

export interface GatewaySubscriptionSyncResult {
  slug: string;
  platform: number;
  fetched: number;
  upserted: number;
  durationMs: number;
  error?: string;
}

export class SyncGatewaySubscriptionsUseCase {
  constructor(
    private readonly fetchers: IGatewaySubscriptionFetcher[],
    private readonly subscriptions: IGatewaySubscriptionRepository,
    private readonly syncState: ISyncStateRepository,
  ) {}

  async execute(): Promise<GatewaySubscriptionSyncResult[]> {
    const results: GatewaySubscriptionSyncResult[] = [];
    for (const fetcher of this.fetchers) {
      results.push(await this.syncOne(fetcher));
    }
    return results;
  }

  private async syncOne(
    fetcher: IGatewaySubscriptionFetcher,
  ): Promise<GatewaySubscriptionSyncResult> {
    const startedAt = Date.now();
    let fetched = 0;
    let upserted = 0;
    let buffer: GatewaySubscriptionProps[] = [];

    const flush = async () => {
      if (buffer.length === 0) return;
      upserted += await this.subscriptions.upsertMany(buffer);
      buffer = [];
    };

    try {
      for await (const sub of fetcher.streamSubscriptions()) {
        buffer.push(sub);
        fetched += 1;
        if (buffer.length >= UPSERT_FLUSH_SIZE) await flush();
      }
      await flush();
    } catch (err) {
      await flush();
      return {
        slug: fetcher.slug,
        platform: fetcher.platform,
        fetched,
        upserted,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    await this.syncState.updateLastSync(`subscriptions:${fetcher.slug}`, new Date(), upserted);

    return {
      slug: fetcher.slug,
      platform: fetcher.platform,
      fetched,
      upserted,
      durationMs: Date.now() - startedAt,
    };
  }
}
