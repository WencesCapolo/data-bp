/**
 * One row of a Provider's Export, already named the way the domain names things
 * rather than the way the Export's Spanish-with-English-parentheses header does.
 *
 * This is the seam the handoff calls for: the Upload reads Exports today and an
 * API will read the same shape tomorrow, so the mapper, the upsert and the
 * provenance row never learn which one produced them. When MercadoPago's
 * credentials land, an API adapter implements `IPaymentExportSource` and the
 * Upload screen goes; nothing downstream of this file changes.
 */
export interface PaymentExportRow {
  /** The Provider's own payment id — `operation_id` in MercadoPago's Export. */
  platformPaymentId: string;
  /** Presentment gross, as the Subscriber was charged. */
  grossAmount: number;
  currency: string;
  /** The Provider's commission, positive. Exports quote it negative. */
  feeAmount: number;
  /** Tax withheld at source, or null where the Provider withholds none.
   *  MercadoPago reports no column for it — it is the gap between gross and
   *  net, and computing it is the adapter's job, not the caller's. */
  taxAmount: number | null;
  /** What the Provider actually moved into the account. */
  netAmount: number;
  refundedAmount: number;
  /** Provider status verbatim: approved, refunded, charged_back, … */
  status: string | null;
  capturedAt: Date | null;
  /** Present when the Export identifies the Subscriber. Used for reporting
   *  only — the join to a Pago is always by id. */
  payerEmail: string | null;
  /** MercadoPago's `operation_type`: recurring_payment, regular_payment. */
  operationType: string | null;
  /** The Provider's own subscription id, where the Export names one — the
   *  all-transactions report's `preapproval_id`. Absent in Exports that do not,
   *  and the repository COALESCEs it, so an Export that cannot see the link
   *  never erases one another source established. */
  subscriptionId?: string | null;
}

/**
 * A source of Export rows for one Provider.
 *
 * Streaming rather than array-returning because an Export is a file of unknown
 * size — 27 months of MercadoPago is hundreds of thousands of rows — and the
 * ingest flushes in batches rather than holding the file in memory.
 */
export interface IPaymentExportSource {
  /** basket_payments.platform value these rows belong to. */
  readonly platform: number;
  readonly slug: string;
  /** What produced the rows, for the provenance record: a filename, or the API. */
  readonly origin: string;
  stream(): AsyncGenerator<PaymentExportRow, void, unknown>;
}
