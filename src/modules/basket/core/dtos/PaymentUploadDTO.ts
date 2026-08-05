// Contract shared by the upload endpoint, the sync endpoint and the modal.
// The Pagos Export is the CSV a person downloads from the Control Panel; see
// CONTEXT.md for the vocabulary and docs/adr/0001 for why it is uploaded by hand.

/** The 15 columns the Control Panel emits, in order. Data rows may omit the
 *  trailing `payment_country` when empty, so the parser must relax column count. */
export const PAYMENT_UPLOAD_COLUMNS = [
  'id',
  'user_id',
  'firstname',
  'lastname',
  'status',
  'status_detail',
  'email',
  'country',
  'platform_payment_id',
  'platform',
  'amount',
  'currency',
  'recurrent',
  'created',
  'payment_country',
] as const;

/** Ceiling for an accepted Upload. A full-history Export is ~20 MB.
 *  Lives here, not in uploadStaging, so the modal can check `file.size` before
 *  spending the user's uplink on a request the server would reject anyway.
 *  Any reverse proxy in front of Next.js must allow at least this much body —
 *  nginx defaults `client_max_body_size` to 1 MB and answers 413 on its own. */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/** One raw row of a Pagos Export, before mapping. All values are strings. */
export type PaymentUploadRow = Record<(typeof PAYMENT_UPLOAD_COLUMNS)[number], string>;

/** Non-blocking advisories shown in the preview. None of these prevent confirming. */
export type UploadWarningCode =
  /** Window shorter than a month — likely leaves gaps in Pagos. */
  | 'short_window'
  /** Zero failed Pagos, which is how the Suscripciones Export looks. */
  | 'looks_like_subscriptions'
  /** Rows whose Subscriber the mirror does not know; they will be skipped. */
  | 'unknown_subscribers'
  /** Amount/currency combinations with no Tier threshold seeded. */
  | 'unmapped_price_points';

export interface UploadWarning {
  code: UploadWarningCode;
  /** Spanish, shown verbatim in the modal. */
  message: string;
  /** How many rows the warning concerns, when meaningful. */
  count?: number;
}

/** Structural failures. The upload is rejected, nothing is written. */
export type UploadRejectionCode =
  /** Content is not CSV — e.g. an Excel workbook, detected by sniffing bytes. */
  | 'not_csv'
  /** Header does not match PAYMENT_UPLOAD_COLUMNS. */
  | 'bad_header'
  /** No data rows at all. */
  | 'empty'
  /** Exceeds the accepted size ceiling. */
  | 'too_large';

export interface UploadRejection {
  error: UploadRejectionCode;
  /** Spanish, shown verbatim in the modal. */
  message: string;
}

/** What the preview step returns. Nothing has been written to the mirror yet. */
export interface UploadPreviewDTO {
  /** Opaque handle to the staged file; passed to the sync endpoint to confirm. */
  uploadId: string;
  filename: string;
  byteSize: number;
  rowTotal: number;
  /** ISO dates, null only when no row had a parseable `created`. */
  windowFrom: string | null;
  windowTo: string | null;
  windowDays: number | null;
  /** Row counts keyed by Provider name (MercadoPago, Stripe, PayPal, Manual, …). */
  byProvider: Record<string, number>;
  /** Pagos that succeeded (status=1) versus not approved (status=0). */
  approved: number;
  /** Umbrella count of status=0. Kept because `looks_like_subscriptions` keys off
   *  it: the Suscripciones Export has none at all. Split for display into the
   *  three fields below, which sum back to it. */
  failed: number;
  /** Declined by the payment method (`status_detail = rejected`). */
  rejected: number;
  /** Not settled yet — chiefly MercadoPago cash rails, which many Subscribers pay
   *  over a counter days later. These are not failures. */
  pending: number;
  /** Abandoned checkouts, refunds and disputes: everything status=0 that is
   *  neither a decline nor still in flight. */
  otherNotApproved: number;
  /** Rows the mapper would drop, chiefly unknown Subscriber. Advisory: Subscribers
   *  are refreshed during the sync that follows, so the final number may be lower. */
  wouldSkip: number;
  warnings: UploadWarning[];
}

/** What the sync endpoint reports once an upload has been ingested. */
export interface UploadResultDTO {
  uploadId: string;
  rowTotal: number;
  rowsIngested: number;
  rowsSkipped: number;
}
