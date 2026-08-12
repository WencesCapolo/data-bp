import type { IPaymentRepository } from '@basket/core/ports/IPaymentRepository';

export interface ReconcilePaymentAmountsResult {
  corrected: number;
}

/**
 * Realigns Pago amounts with what the gateway actually charged.
 *
 * Runs as a sync step rather than as a one-off migration because the defect is
 * upstream: the Control Panel export encodes some CLP amounts with two decimal
 * places, and CLP has none. Every ingest rewrites `amount` from that export, so
 * a correction applied once is undone by the next sync. Re-running it after each
 * ingest is the only thing that keeps the mirror true while the export stays
 * wrong. See docs/adr/0006.
 */
export class ReconcilePaymentAmountsUseCase {
  constructor(private readonly payments: IPaymentRepository) {}

  async execute(): Promise<ReconcilePaymentAmountsResult> {
    return { corrected: await this.payments.reconcileAmountScale() };
  }
}
