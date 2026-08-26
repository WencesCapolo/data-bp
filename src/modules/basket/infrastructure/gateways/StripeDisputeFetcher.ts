import type { GatewayDisputeProps } from '@basket/core/entities/GatewayDispute';
import type { GatewayWindowSource, MirrorWindow } from '@basket/core/ports/IGatewayMirror';
import { getJson } from './httpJson';
import { fromMinorUnits, round2 } from './money';

const STRIPE_PLATFORM = 4;
const API = 'https://api.stripe.com/v1/disputes';
const PAGE_SIZE = 100;

export interface StripeDisputeFetcherConfig {
  secretKey: string;
  apiVersion?: string;
  onRetry?: (info: { attempt: number; status: number | null; waitMs: number; reason: string }) => void;
}

interface StripeDisputeBalanceTransaction {
  fee: number;
  currency: string;
}

interface StripeDispute {
  id: string;
  charge: string | { id: string } | null;
  payment_intent: string | { id: string } | null;
  amount: number;
  currency: string;
  status: string;
  reason: string | null;
  created: number;
  is_charge_refundable: boolean | null;
  evidence_details: { due_by: number | null } | null;
  /** Present inline, unexpanded — Stripe returns these as objects already. */
  balance_transactions: StripeDisputeBalanceTransaction[] | null;
}

interface StripeDisputeList {
  data: StripeDispute[];
  has_more: boolean;
}

/**
 * Reads disputes over a window of their creation.
 *
 * Windowed rather than full, unlike customers and subscriptions, because a
 * dispute is opened once and closes within weeks: a trailing overlap catches
 * every status change it will ever have. The window is over `created`, which is
 * when the case opened — not when the charge was made, which can be months
 * earlier. Bucketing dispute counts by month therefore means "cases opened that
 * month", and any view over this table should say so.
 */
export class StripeDisputeFetcher implements GatewayWindowSource<GatewayDisputeProps> {
  readonly platform = STRIPE_PLATFORM;
  readonly slug = 'stripe';

  constructor(private readonly cfg: StripeDisputeFetcherConfig) {
    if (!cfg.secretKey) throw new Error('StripeDisputeFetcher requires a secret key');
  }

  async *stream(window: MirrorWindow): AsyncGenerator<GatewayDisputeProps> {
    let startingAfter: string | null = null;

    for (;;) {
      const url = new URL(API);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('created[gte]', String(unix(window.from)));
      url.searchParams.set('created[lt]', String(unix(window.to)));
      if (startingAfter) url.searchParams.set('starting_after', startingAfter);

      const headers: Record<string, string> = { authorization: `Bearer ${this.cfg.secretKey}` };
      if (this.cfg.apiVersion) headers['stripe-version'] = this.cfg.apiVersion;

      const page = await getJson<StripeDisputeList>(url.toString(), {
        headers,
        onRetry: this.cfg.onRetry,
      });

      for (const d of page.data) {
        const record = toProps(d);
        if (record) yield record;
      }

      if (!page.has_more || page.data.length === 0) return;
      startingAfter = page.data[page.data.length - 1].id;
    }
  }
}

function toProps(d: StripeDispute): GatewayDisputeProps | null {
  const chargeId = idOf(d.charge);
  // The same key basket_payment_fees stores: the PaymentIntent id where there is
  // one, the charge id otherwise. A dispute with neither cannot be joined to a
  // Pago and there is nothing useful to record about it.
  const joinKey = idOf(d.payment_intent) ?? chargeId;
  if (!joinKey) return null;

  // The case fee lives on the dispute's balance transactions, in the SETTLEMENT
  // currency — never in d.currency, which is the charge's. A won dispute adds a
  // second, reversing transaction, so these are summed rather than taken from
  // the first: the total is what the account actually paid for the case.
  const bts = d.balance_transactions ?? [];
  const feeAmount = bts.length
    ? round2(bts.reduce((sum, bt) => sum + fromMinorUnits(bt.fee, bt.currency), 0))
    : null;

  return {
    platform: STRIPE_PLATFORM,
    disputeId: d.id,
    platformPaymentId: joinKey,
    chargeId,
    amount: fromMinorUnits(d.amount, d.currency),
    currency: d.currency.toUpperCase(),
    status: d.status,
    reason: d.reason,
    feeAmount,
    settlementCurrency: bts[0]?.currency.toUpperCase() ?? null,
    isChargeRefundable: d.is_charge_refundable ?? null,
    evidenceDueBy: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null,
    createdAt: new Date(d.created * 1000),
  };
}

function idOf(value: string | { id: string } | null): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

function unix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
