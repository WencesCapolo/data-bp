import type { GatewayFeeProps } from '@basket/core/entities/GatewayFee';
import type { IGatewayFeeRepository } from '@basket/core/ports/IGatewayFeeRepository';
import type { IPaymentExportSource } from '@basket/core/ports/IPaymentExportSource';

const UPSERT_FLUSH_SIZE = 500;

export interface PaymentExportIngestResult {
  slug: string;
  platform: number;
  origin: string;
  rows: number;
  /** Rows the adapter refused — no Provider id, so nothing to join to. */
  skipped: number;
  upserted: number;
  /** Rows carrying a withholding, and their total. Reported because the column
   *  is a residual rather than something the Export states, so a run where it
   *  is suddenly zero means the Export's shape moved. */
  withTax: number;
  taxTotal: number;
  grossTotal: number;
  feeTotal: number;
  netTotal: number;
  /** Refunds and chargebacks the Export reported. Zero for an Export that only
   *  carries approved payments, which is a silence rather than a measurement —
   *  see docs/handoff/mercadopago-sftp-all-transactions.md. */
  refundedTotal: number;
  from: Date | null;
  to: Date | null;
  durationMs: number;
}

/**
 * Reads one Provider Export into the fee mirror.
 *
 * Deliberately the same destination the API fetchers write to, and deliberately
 * ignorant of which source produced the rows: `IPaymentExportSource` is
 * implemented by a file adapter today and will be implemented by an API adapter
 * when MercadoPago's credentials land. That is the whole point of the seam — the
 * Upload screen is replaceable, the mirror is not.
 *
 * The totals are returned rather than logged so the caller can print them, and
 * so a test can assert on them. They are per-Export, never accumulated across
 * currencies, because summing ARS into a total that also holds USD is the one
 * arithmetic mistake this codebase keeps having to un-make.
 */
export class IngestPaymentExportUseCase {
  constructor(private readonly fees: IGatewayFeeRepository) {}

  async execute(source: IPaymentExportSource): Promise<PaymentExportIngestResult> {
    const startedAt = Date.now();
    const tally = {
      rows: 0, skipped: 0, upserted: 0, withTax: 0,
      taxTotal: 0, grossTotal: 0, feeTotal: 0, netTotal: 0, refundedTotal: 0,
      minMs: Infinity, maxMs: -Infinity,
    };

    let buffer: GatewayFeeProps[] = [];
    const flush = async () => {
      if (buffer.length === 0) return;
      tally.upserted += await this.fees.upsertMany(buffer);
      buffer = [];
    };

    for await (const row of source.stream()) {
      tally.rows += 1;
      tally.grossTotal += row.grossAmount;
      tally.feeTotal += row.feeAmount;
      tally.netTotal += row.netAmount;
      tally.refundedTotal += row.refundedAmount;
      if (row.taxAmount != null) {
        tally.withTax += 1;
        tally.taxTotal += row.taxAmount;
      }
      if (row.capturedAt) {
        const ms = row.capturedAt.getTime();
        if (ms < tally.minMs) tally.minMs = ms;
        if (ms > tally.maxMs) tally.maxMs = ms;
      }

      buffer.push({
        platform: source.platform,
        platformPaymentId: row.platformPaymentId,
        grossAmount: row.grossAmount,
        currency: row.currency,
        feeAmount: row.feeAmount,
        taxAmount: row.taxAmount,
        netAmount: row.netAmount,
        // MercadoPago settles ARS into ARS: the settlement plane collapses onto
        // the presentment plane and there is no rate to record. A Provider that
        // converted would need its settlement figures from its own Export, not
        // from arithmetic on these.
        settlementCurrency: row.currency,
        settlementAmount: row.grossAmount,
        exchangeRate: null,
        refundedAmount: row.refundedAmount,
        gatewayStatus: row.status,
        capturedAt: row.capturedAt,
        // No Export carries an invoice. A subscription id only some of them do:
        // MercadoPago's all-transactions report names a `preapproval_id`, the
        // Cobros Export names nothing. Null is honest, and the repository
        // COALESCEs rather than overwrites, so an Export that cannot see the link
        // never erases one the API or another Export established.
        invoiceId: null,
        subscriptionId: row.subscriptionId ?? null,
      });
      if (buffer.length >= UPSERT_FLUSH_SIZE) await flush();
    }
    await flush();

    return {
      slug: source.slug,
      platform: source.platform,
      origin: source.origin,
      rows: tally.rows,
      skipped: tally.skipped,
      upserted: tally.upserted,
      withTax: tally.withTax,
      taxTotal: round2(tally.taxTotal),
      grossTotal: round2(tally.grossTotal),
      feeTotal: round2(tally.feeTotal),
      netTotal: round2(tally.netTotal),
      refundedTotal: round2(tally.refundedTotal),
      from: Number.isFinite(tally.minMs) ? new Date(tally.minMs) : null,
      to: tally.maxMs > 0 ? new Date(tally.maxMs) : null,
      durationMs: Date.now() - startedAt,
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
