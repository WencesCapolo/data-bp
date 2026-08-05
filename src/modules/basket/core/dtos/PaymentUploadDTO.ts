// Contract shared by the upload endpoint, the sync endpoint and the modal.
// The Cobros Export is the CSV a person downloads from the Control Panel; see
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

/** One raw row of a Cobros Export, before mapping. All values are strings. */
export type PaymentUploadRow = Record<(typeof PAYMENT_UPLOAD_COLUMNS)[number], string>;

/** Non-blocking advisories shown in the preview. None of these prevent confirming. */
export type UploadWarningCode =
  /** Window shorter than a month — likely leaves gaps in Cobros. */
  | 'short_window'
  /** Zero failed Cobros, which is how the Suscripciones Export looks. */
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
  /** Cobros that succeeded (status=1) versus failed (status=0). */
  approved: number;
  failed: number;
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
