import type { GatewaySubscriptionProps } from '@basket/core/entities/GatewaySubscription';
import type { IGatewaySubscriptionFetcher } from '@basket/core/ports/IGatewaySubscriptionFetcher';
import { getJson } from './httpJson';

const MP_PLATFORM = 0;
const API = 'https://api.mercadopago.com/preapproval/search';
const PAGE_SIZE = 100;

export interface MercadoPagoSubscriptionFetcherConfig {
  accessToken: string;
  /** Earliest `date_created` worth asking for. The first preapproval on this
   *  account is 2021-03-03; the default leaves a margin. */
  since?: Date;
  /** Injected by tests; the run's "now" otherwise. */
  now?: () => Date;
  onRetry?: (info: { attempt: number; status: number | null; waitMs: number; reason: string }) => void;
  onPage?: (fetched: number) => void;
  /** A window that still exceeds the ceiling at 1-second width — the only case
   *  in which this fetcher knowingly leaves rows unread. */
  onWindowOverflow?: (window: { from: Date; to: Date }, total: number) => void;
}

interface MpAutoRecurring {
  frequency: number | null;
  frequency_type: string | null;
  transaction_amount: number | null;
  currency_id: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface MpPreapproval {
  id: string;
  payer_id: number | null;
  status: string;
  date_created: string | null;
  last_modified: string | null;
  next_payment_date: string | null;
  auto_recurring: MpAutoRecurring | null;
}

interface MpPreapprovalSearch {
  paging: { total: number; limit: number; offset: number };
  results: MpPreapproval[];
}

/**
 * `/preapproval/search` refuses `offset + limit >= 10000`, so no single query
 * can read past its 9 900th result and the 298k preapprovals here are
 * reachable only in slices. The slice axis is `date_created`, which the
 * endpoint filters through `range=date_created:after:<iso>,before:<iso>`.
 * Both bounds are mandatory: an open-ended range is a 400.
 */
// `offset + limit < 10000` is strict, so the last legal page starts at 9800.
const MAX_OFFSET = 9_800;
const RESULT_CAP = MAX_OFFSET + PAGE_SIZE;
const MIN_SPLIT_MS = 1000;
const DEFAULT_SINCE = new Date('2021-01-01T00:00:00.000Z');
const MONTH_MS = 31 * 24 * 60 * 60 * 1000;

interface Window { from: Date; to: Date }

/**
 * Reads every preapproval — MercadoPago's word for a subscription — on every run.
 *
 * Same contract as the Stripe fetcher for the same reason: cancellation is an
 * update to an old object, so the whole set is re-read and upserted. (The
 * endpoint does accept `range=last_modified:…`, which would allow a delta;
 * IGatewaySubscriptionFetcher does not model one yet.)
 *
 * The set is walked in month-wide `date_created` windows from `since` to now,
 * each paged at 100 and halved recursively whenever it would exceed the
 * 10 000-result ceiling. ~75k preapprovals a year means ~6k a month, so the
 * split rarely fires. Consecutive windows share a boundary instant; a row
 * created exactly there is read twice and upserted twice, which is harmless,
 * whereas trimming the boundary would risk a gap.
 */
export class MercadoPagoSubscriptionFetcher implements IGatewaySubscriptionFetcher {
  readonly platform = MP_PLATFORM;
  readonly slug = 'mercadopago';

  constructor(private readonly cfg: MercadoPagoSubscriptionFetcherConfig) {
    if (!cfg.accessToken) throw new Error('MercadoPagoSubscriptionFetcher requires an access token');
  }

  async *streamSubscriptions(): AsyncGenerator<GatewaySubscriptionProps> {
    const now = this.cfg.now?.() ?? new Date();
    // One minute of slack so a preapproval created while the run starts is not
    // sliced off by the last window's upper bound.
    const end = new Date(now.getTime() + 60_000);
    let fetched = 0;
    for (const window of monthWindows(this.cfg.since ?? DEFAULT_SINCE, end)) {
      for await (const row of this.splitOrPage(window)) {
        fetched += 1;
        yield row;
      }
      this.cfg.onPage?.(fetched);
    }
  }

  private async *splitOrPage(window: Window): AsyncGenerator<GatewaySubscriptionProps> {
    const first = await this.fetchPage(window, 0);
    const total = first.paging.total;

    if (total > RESULT_CAP) {
      const spanMs = window.to.getTime() - window.from.getTime();
      if (spanMs > MIN_SPLIT_MS) {
        const mid = new Date(window.from.getTime() + Math.floor(spanMs / 2));
        yield* this.splitOrPage({ from: window.from, to: mid });
        yield* this.splitOrPage({ from: mid, to: window.to });
        return;
      }
      this.cfg.onWindowOverflow?.(window, total);
    }

    for (const p of first.results) yield toProps(p);
    if (first.results.length < PAGE_SIZE) return;

    for (let offset = PAGE_SIZE; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
      const page = await this.fetchPage(window, offset);
      for (const p of page.results) yield toProps(p);
      if (page.results.length < PAGE_SIZE) return;
    }
  }

  private fetchPage(window: Window, offset: number): Promise<MpPreapprovalSearch> {
    const url = new URL(API);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('sort', 'date_created:asc');
    url.searchParams.set(
      'range',
      `date_created:after:${window.from.toISOString()},before:${window.to.toISOString()}`,
    );
    return getJson<MpPreapprovalSearch>(url.toString(), {
      headers: { authorization: `Bearer ${this.cfg.accessToken}` },
      onRetry: this.cfg.onRetry,
    });
  }
}

/** Half-open month-ish slices covering [since, end). Exported for the test. */
export function* monthWindows(since: Date, end: Date): Generator<Window> {
  let from = since;
  while (from < end) {
    const to = new Date(Math.min(from.getTime() + MONTH_MS, end.getTime()));
    yield { from, to };
    from = to;
  }
}

export function toProps(p: MpPreapproval): GatewaySubscriptionProps {
  const ar = p.auto_recurring;
  return {
    platform: MP_PLATFORM,
    // The hex32 that basket_payments.platform_payment_id already carries.
    subscriptionId: p.id,
    customerId: p.payer_id != null ? String(p.payer_id) : null,
    // Verbatim, like every other gateway word here: authorized, paused,
    // cancelled (double l), pending. Views map it; the mirror does not.
    status: p.status,
    currency: ar?.currency_id?.toUpperCase() ?? null,
    amount: ar?.transaction_amount ?? null,
    // 'months' | 'days' as MercadoPago words it; a yearly plan is 12 months.
    interval: ar?.frequency_type ?? null,
    intervalCount: ar?.frequency ?? null,
    createdAt: iso(p.date_created),
    currentPeriodStart: iso(ar?.start_date),
    currentPeriodEnd: iso(ar?.end_date),
    // A preapproval goes straight to `cancelled` and records no "when"; only
    // `last_modified` moves, and that is a different fact (any edit moves it).
    // Null is the honest answer — churn views read `status` for this platform.
    cancelAtPeriodEnd: false,
    cancelAt: null,
    canceledAt: null,
    endedAt: null,
    trialEnd: null,
  };
}

function iso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
