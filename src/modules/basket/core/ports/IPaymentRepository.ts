import { Payment, PaymentProps } from '../entities/Payment';

export interface IPaymentRepository {
  upsertMany(payments: PaymentProps[]): Promise<number>;
  findById(id: number): Promise<Payment | null>;
  count(): Promise<number>;
  countActiveOn(date: Date): Promise<number>;
}
