// `status` is approved (1) or not (0). `status_detail` is the reason, and it is
// the only way to tell a real decline from a payment that has simply not settled
// yet — the Control Panel puts both under status=0.
//
// MercadoPago's cash rails (Rapipago, PagoFácil, boleto) sit at `pending` until
// the person pays over a counter, and many later settle as approved. Counting
// those as failures overstates the failure rate by roughly 2.4x, so they are
// reported apart.

/** `status_detail` values seen in the Pagos Export, normalized. */
export type PaymentStatusDetail =
  | 'approved'
  | 'pending'
  | 'in_process'
  | 'rejected'
  | 'cancelled'
  | 'incomplete_expired'
  | 'refunded'
  | 'in_mediation';

/**
 * Lowercases, trims, and folds the two spellings the Export uses for the same
 * state: MercadoPago writes `cancelled`, Stripe writes `canceled`. Left
 * unnormalized they split every group-by in two.
 */
export function normalizeStatusDetail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  return v === 'canceled' ? 'cancelled' : v;
}

/** How a non-approved Pago is reported. `other` covers post-charge reversals
 *  (refunds, disputes) and details we have not classified. */
export type NotApprovedKind = 'pending' | 'rejected' | 'other';

/** Still in flight — the money may yet arrive. */
const PENDING_DETAILS = new Set(['pending', 'in_process']);

/** Declined by the payment method. Abandoned checkouts (`cancelled`,
 *  `incomplete_expired`) are deliberately NOT counted here: nobody declined
 *  them, so folding them in would inflate the decline rate. */
const REJECTED_DETAILS = new Set(['rejected']);

export function classifyNotApproved(statusDetail: string | null | undefined): NotApprovedKind {
  const detail = normalizeStatusDetail(statusDetail);
  if (detail && PENDING_DETAILS.has(detail)) return 'pending';
  if (detail && REJECTED_DETAILS.has(detail)) return 'rejected';
  return 'other';
}
