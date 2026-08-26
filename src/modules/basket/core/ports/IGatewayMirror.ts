import type { FeeWindow } from './IGatewayFeeFetcher';

/**
 * The shape every gateway mirror shares.
 *
 * `basket_payment_fees` and `basket_gateway_subscriptions` each got their own
 * port, fetcher, repository and use case, and the third, fourth and fifth
 * mirrors would have copied ~120 lines of identical windowing and flushing
 * apiece. What actually differs between them is two things: whether the Provider
 * lets you read a delta, and which row type comes back. Both are captured here.
 *
 * A mirror is read one of two ways, and which one is a fact about the data, not
 * a preference:
 *
 *   * **Windowed** — the object is stamped with a moment and, once its dust has
 *     settled, never changes again. Fees, disputes, payouts. Read a window, with
 *     a trailing overlap for the days in which it can still change.
 *   * **Full** — the object's decisive field is mutable long after creation, and
 *     the Provider offers no `updated` filter. Subscriptions (cancellation),
 *     customers (email). Any window would systematically miss exactly the change
 *     the mirror exists to carry, so the whole set is re-read.
 */

export type MirrorWindow = FeeWindow;

/** A Provider source that can answer for a slice of time. */
export interface GatewayWindowSource<T> {
  /** basket_payments.platform value these rows belong to. */
  readonly platform: number;
  /** Short slug for logs and sync-state keys: 'stripe', 'mercadopago'. */
  readonly slug: string;
  stream(window: MirrorWindow): AsyncGenerator<T, void, unknown>;
}

/** A Provider source that can only be read whole. */
export interface GatewayFullSource<T> {
  readonly platform: number;
  readonly slug: string;
  stream(): AsyncGenerator<T, void, unknown>;
}

/**
 * What a mirror table has to offer the sync. Deliberately tiny: a mirror is
 * write-mostly, and any reading beyond a row count belongs to the query
 * repository that serves the tab, not here.
 */
export interface IGatewayMirrorRepository<T> {
  upsertMany(rows: T[]): Promise<number>;
  count(): Promise<number>;
}
