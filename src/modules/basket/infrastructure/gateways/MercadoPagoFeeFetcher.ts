import type { GatewayFeeProps } from '@basket/core/entities/GatewayFee';
import type { FeeWindow, IGatewayFeeFetcher } from '@basket/core/ports/IGatewayFeeFetcher';
import { getJson } from './httpJson';
import { round2 } from './money';

const MP_PLATFORM = 0;
const API = 'https://api.mercadopago.com/v1/payments/search';
const PAGE_SIZE = 100;

/**
 * MercadoPago refuses `offset + limit > 1000` on the search endpoint. It is a
 * hard wall, not a soft one: there is no cursor and no way to reach result 1001
 * of a window. The only way through is to make windows small enough that no
 * window holds more than 1000 results — hence the recursive split below.
 */
const MAX_OFFSET = 1000 - PAGE_SIZE;
const RESULT_CAP = 1000;

/** Below this a window cannot be split usefully any more; see splitOrPage. */
const MIN_SPLIT_MS = 1000;

export interface MercadoPagoFeeFetcherConfig {
  accessToken: string;
  onRetry?: (info: { attempt: number; status: number | null; waitMs: number; reason: string }) => void;
  /** Reports a window that exceeded 1000 results at 1-second granularity, i.e.
   *  the only case where this fetcher knowingly loses rows. */
  onWindowOverflow?: (window: FeeWindow, total: number) => void;
}

interface MpFeeDetail {
  type: string;
  amount: number;
  fee_payer: string;
}

interface MpPayment {
  id: number;
  status: string;
  currency_id: string;
  transaction_amount: number;
  transaction_amount_refunded: number | null;
  date_created: string;
  date_approved: string | null;
  fee_details: MpFeeDetail[] | null;
  transaction_details: { net_received_amount: number | null } | null;
}

interface MpSearchResponse {
  paging: { total: number; limit: number; offset: number };
  results: MpPayment[];
}

/**
 * Reads fees from the payment-search endpoint, one time window at a time.
 *
 * Per-id lookups were the obvious alternative and are 273k requests. Search
 * returns 100 payments per request with `fee_details` already inline, so the
 * same coverage costs ~2.8k requests. The price of that is the 1000-result
 * ceiling, which this class absorbs by halving any window that exceeds it.
 */
export class MercadoPagoFeeFetcher implements IGatewayFeeFetcher {
  readonly platform = MP_PLATFORM;
  readonly slug = 'mercadopago';

  constructor(private readonly cfg: MercadoPagoFeeFetcherConfig) {
    if (!cfg.accessToken) throw new Error('MercadoPagoFeeFetcher requires an access token');
  }

  async *streamFees(window: FeeWindow): AsyncGenerator<GatewayFeeProps> {
    yield* this.splitOrPage(window);
  }

  /**
   * Probes the window's size with one request, then either pages it or halves it.
   *
   * The probe is not wasted work: its results are yielded, so a window that fits
   * costs exactly the pages it needs. A window that does not fit costs one extra
   * request per split level, which is cheap next to the 1000 rows it unlocks.
   */
  private async *splitOrPage(window: FeeWindow): AsyncGenerator<GatewayFeeProps> {
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
      // A single second holding >1000 payments. Not reachable at current volume
      // (~340/day), but if it ever happens the rows past 1000 are unreachable by
      // any query MercadoPago offers, so say so loudly instead of reporting a
      // clean run.
      this.cfg.onWindowOverflow?.(window, total);
    }

    for (const payment of first.results) yield toFeeProps(payment);
    if (first.results.length < PAGE_SIZE) return;

    for (let offset = PAGE_SIZE; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
      const page = await this.fetchPage(window, offset);
      for (const payment of page.results) yield toFeeProps(payment);
      if (page.results.length < PAGE_SIZE) return;
    }
  }

  private fetchPage(window: FeeWindow, offset: number): Promise<MpSearchResponse> {
    const url = new URL(API);
    url.searchParams.set('range', 'date_created');
    url.searchParams.set('begin_date', mpDate(window.from));
    // Our windows are half-open; MercadoPago's end_date is inclusive, so stepping
    // back a millisecond is what stops consecutive windows overlapping on their
    // shared boundary and upserting the same payment twice.
    url.searchParams.set('end_date', mpDate(new Date(window.to.getTime() - 1)));
    url.searchParams.set('sort', 'date_created');
    url.searchParams.set('criteria', 'asc');
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));

    return getJson<MpSearchResponse>(url.toString(), {
      headers: { authorization: `Bearer ${this.cfg.accessToken}` },
      onRetry: this.cfg.onRetry,
    });
  }
}

function toFeeProps(p: MpPayment): GatewayFeeProps {
  const currency = (p.currency_id ?? 'ARS').toUpperCase();
  const gross = p.transaction_amount ?? 0;

  // Only the collector's share is our cost. fee_details also lists fees charged
  // to the payer (instalment financing), which the subscriber pays on top of the
  // price and which never leaves our balance.
  const collectorFees = (p.fee_details ?? [])
    .filter((f) => f.fee_payer === 'collector')
    .reduce((sum, f) => sum + (f.amount ?? 0), 0);

  const reportedNet = p.transaction_details?.net_received_amount;
  // Prefer MercadoPago's own net when it gives one; derive it only as a fallback
  // so the two numbers can never disagree by a rounding cent.
  const net = reportedNet != null ? round2(reportedNet) : round2(gross - collectorFees);
  const fee = reportedNet != null && collectorFees === 0
    ? round2(gross - reportedNet)
    : round2(collectorFees);

  const approvedAt = p.date_approved ?? p.date_created;

  return {
    platform: MP_PLATFORM,
    platformPaymentId: String(p.id),
    grossAmount: round2(gross),
    currency,
    feeAmount: fee,
    // The API's fee_details do not separate the tax withheld at source — only
    // the Cobros Export does, and only as the gap between gross and net. Null
    // here says "this source cannot answer", which is true; the Export path
    // fills it in. See migrations/sql/0015.
    taxAmount: null,
    netAmount: net,
    // MercadoPago settles ARS into ARS and reports no conversion, so the
    // settlement plane collapses onto the presentment plane. ARS→USD is a
    // separate decision with a separate source and is not invented here.
    settlementCurrency: currency,
    settlementAmount: round2(gross),
    exchangeRate: null,
    refundedAmount: round2(p.transaction_amount_refunded ?? 0),
    gatewayStatus: p.status ?? null,
    capturedAt: approvedAt ? new Date(approvedAt) : null,
    // MercadoPago has no invoice object, and a payment made under a preapproval
    // does not carry the preapproval id on the payment itself. Linking a
    // MercadoPago charge to its subscription needs the preapproval search, which
    // is a separate fetcher and is not built yet — so this is honestly null
    // rather than guessed from timing or amount.
    invoiceId: null,
    subscriptionId: null,
  };
}

/** MercadoPago wants millisecond precision with an explicit offset. */
function mpDate(date: Date): string {
  return date.toISOString().replace('Z', '-00:00');
}
