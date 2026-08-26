// Contract shared by the fee-Export upload endpoints and the Upload screen.
//
// A *fee* Export is not the Pagos Export. The Pagos Export is our own Control
// Panel's CSV and it lands in `basket_payments` through a full Sync; a fee
// Export comes from the Provider, lands in `basket_payment_fees` through
// `IngestPaymentExportUseCase`, and needs no Sync at all — nothing else in the
// pipeline depends on it, so it writes and refreshes the one view that reads it.
// Two flows, one screen, and this file is why they can share the screen without
// sharing a shape: see docs/handoff/financiero-continue-here.md step 2.

/**
 * Ceiling for a fee Export. The same one the Pagos Upload uses, and for the same
 * reason it lives in a DTO: the screen checks `file.size` before spending the
 * uplink on a request the server would refuse. A monthly Cobros Export is ~2 MB,
 * so this is generous on purpose — the panel, not the ceiling, is what keeps
 * these files to a month.
 */
export const MAX_FEE_UPLOAD_BYTES = 64 * 1024 * 1024;

/** Which Provider Export a file claims to be. */
export type FeeExportSourceId = 'mercadopago_cobros' | 'mercadopago_all_transactions';

export interface FeeExportSourceSpec {
  id: FeeExportSourceId;
  /** Shown in the picker. */
  label: string;
  /** One line under the label: what the Export is and where it comes from. */
  hint: string;
  /** basket_payments.platform these rows belong to. */
  platform: number;
  /** `accept` for the file input. MercadoPago's panel hands back .xlsx. */
  accept: string;
  /**
   * Machine names that must appear in the header. The header is bilingual —
   * `Tarifa de Mercado Pago (mercadopago_fee)` — and only the parenthesised half
   * is stable, so this is what a wrong-Export check can key on.
   */
  requiredColumns: string[];
  /**
   * What the Provider's commission is known to cost, as a share of gross. The
   * bounds are wide on purpose — they are here to catch a *moved column*, not to
   * police pricing. MercadoPago's is a flat 1.80%.
   */
  feePctRange: [number, number];
  /**
   * The most withholding that can plausibly be a withholding. MercadoPago's
   * measured 5.51% of gross; a "withholding" of half the charge is an amount
   * column that moved, because the withholding has no column of its own and is
   * recovered as the residual — so a wrong `net` column becomes a giant tax
   * rather than an arithmetic error that anything else would catch.
   */
  maxTaxPct: number;
}

export const FEE_EXPORT_SOURCES: FeeExportSourceSpec[] = [
  {
    id: 'mercadopago_cobros',
    label: 'Cobros de MercadoPago',
    hint: 'Comisiones y retenciones, un mes por archivo. El panel lo entrega en .xlsx.',
    platform: 0,
    accept: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv',
    requiredColumns: [
      'operation_id',
      'transaction_amount',
      'mercadopago_fee',
      'net_received_amount',
      'date_approved',
    ],
    feePctRange: [1.0, 3.0],
    maxTaxPct: 15,
  },
  {
    id: 'mercadopago_all_transactions',
    label: 'Todas las transacciones de MercadoPago',
    hint: 'Cobros, reembolsos y contracargos. Es el que el panel empuja al SFTP; también se puede subir a mano.',
    platform: 0,
    accept: '.csv,text/csv',
    // UPPERCASE in the file and matched lower-cased, because this header has no
    // parenthesised machine names at all: the columns ARE the machine names.
    requiredColumns: [
      'source_id',
      'transaction_type',
      'transaction_date',
      'transaction_amount',
      'fee_amount',
      'taxes_amount',
      'settlement_net_amount',
    ],
    // Wider than the Cobros band, and not because MercadoPago charges more: this
    // report's `FEE_AMOUNT` is the commission WITH its IVA, where the Cobros
    // Export's `mercadopago_fee` is the commission alone. Measured 6.11% on the
    // first real file against 1.80% for the same column name next door — which
    // is exactly why the two Exports cannot share a band.
    feePctRange: [1.0, 9.0],
    // The withholding is stated here (`TAXES_AMOUNT`) rather than recovered as
    // the residual, so this ceiling no longer stands between us and a moved `net`
    // column — the invariant does, because tax is no longer whatever is left
    // over. Kept, wide, as the check on a moved `TAXES_AMOUNT` itself. Measured
    // 3.23%.
    maxTaxPct: 12,
  },
];

export function feeExportSource(id: string): FeeExportSourceSpec | null {
  return FEE_EXPORT_SOURCES.find((s) => s.id === id) ?? null;
}

/** Advisories. None of these stop a confirm. */
export type FeeUploadWarningCode =
  /** Ids in the file that `basket_payments` has no Pago for — a fee row still
   *  lands, keyed by the Provider's id, and joins if the Pago ever arrives. */
  | 'unmatched_payments'
  /** Ids that already carry a fee row: this Export overlaps one already ingested. */
  | 'already_ingested'
  /** Rows the adapter dropped for want of a Provider id. */
  | 'rows_without_id'
  /** The same id twice in one file; the last one wins. */
  | 'duplicate_ids'
  /** No row reports a withholding, which for MercadoPago means the column moved. */
  | 'no_withholding'
  /** Commission outside the band this Provider is known to charge. */
  | 'unexpected_fee_pct'
  /** The file spans more than one calendar month. Not wrong, just unexpected. */
  | 'wide_window';

export interface FeeUploadWarning {
  code: FeeUploadWarningCode;
  /** Spanish, shown verbatim. */
  message: string;
  count?: number;
}

/** Structural failures. Nothing is written and the staged file is dropped. */
export type FeeUploadRejectionCode =
  /** Not a workbook and not a CSV. */
  | 'bad_format'
  /** Header is missing the machine names this Export must have. */
  | 'bad_header'
  /** Parsed clean and yielded no usable row. */
  | 'empty'
  /** Over the size ceiling. */
  | 'too_large'
  /**
   * `gross - fee - tax != net`. The one rejection that is about arithmetic
   * rather than shape, and the reason it exists: MercadoPago's withholding has
   * no column and is recovered as the residual, so a moved or renamed amount
   * column still parses, still looks plausible, and quietly reports a different
   * cost of payments. Refused here rather than discovered in a chart.
   */
  | 'invariant_broken'
  /**
   * The arithmetic closes and the figures are still not this Export's. The
   * withholding is a residual, so a moved `net` column produces a file that
   * balances perfectly and reports MercadoPago as keeping half the money — the
   * invariant cannot see it and the header cannot either. The ratios can.
   */
  | 'implausible_amounts'
  /** Unknown source id. */
  | 'unknown_source'
  /** The staged file is gone — the preview expired before it was confirmed. */
  | 'expired';

export interface FeeUploadRejection {
  error: FeeUploadRejectionCode;
  message: string;
}

/** What the preview measured. Nothing has been written to the mirror yet. */
export interface FeeUploadPreviewDTO {
  uploadId: string;
  source: FeeExportSourceId;
  sourceLabel: string;
  platformName: string;
  filename: string;
  byteSize: number;
  /** Rows the adapter would write. */
  rows: number;
  /** Rows it dropped for want of a Provider id. */
  skipped: number;
  currency: string;
  grossTotal: number;
  feeTotal: number;
  taxTotal: number;
  netTotal: number;
  /** Commission and withholding as shares of gross — the two figures that make
   *  a wrong-column Export obvious at a glance. MercadoPago: ~1.80% and ~5.5%. */
  feePct: number;
  taxPct: number;
  rowsWithTax: number;
  windowFrom: string | null;
  windowTo: string | null;
  /** Ids present in `basket_payments`, and ids that already carry a fee row. */
  matchedPagos: number;
  alreadyIngested: number;
  /** Status values in the file, counted. MercadoPago's Cobros Export is all
   *  `approved`; anything else here means the panel's filter changed. */
  byStatus: Record<string, number>;
  warnings: FeeUploadWarning[];
}

/** What confirming reports. The fee mirror is written by the time this returns. */
export interface FeeUploadResultDTO {
  uploadId: string;
  source: FeeExportSourceId;
  rows: number;
  upserted: number;
  skipped: number;
  grossTotal: number;
  feeTotal: number;
  taxTotal: number;
  netTotal: number;
  windowFrom: string | null;
  windowTo: string | null;
  /** Milliseconds spent rebuilding `basket_mat_gateway_net_daily`, or null when
   *  the refresh failed — the rows are in either way and the view catches up on
   *  the next cron, so a failed refresh is reported, not thrown. */
  viewRefreshMs: number | null;
}
