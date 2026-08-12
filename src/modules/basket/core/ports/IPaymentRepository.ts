import { Payment, PaymentProps } from '../entities/Payment';

export interface IPaymentRepository {
  upsertMany(payments: PaymentProps[]): Promise<number>;
  findById(id: number): Promise<Payment | null>;
  count(): Promise<number>;
  countActiveOn(date: Date): Promise<number>;
  /**
   * Rewrites Pagos whose stored amount is off from the gateway's by exactly a
   * factor of 100, using basket_payment_fees as truth. Returns rows changed.
   *
   * Must run after every ingest, not once: the bug is in the Control Panel
   * export, so the upsert reintroduces it from the source every time. See
   * docs/adr/0006.
   */
  reconcileAmountScale(): Promise<number>;
}
