import type { GatewaySubscriptionProps } from '../entities/GatewaySubscription';

export interface SubscriptionStatusCount {
  platform: number;
  status: string;
  count: number;
}

export interface IGatewaySubscriptionRepository {
  upsertMany(subscriptions: GatewaySubscriptionProps[]): Promise<number>;
  count(): Promise<number>;
  countByStatus(): Promise<SubscriptionStatusCount[]>;
}
