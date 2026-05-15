import type { PaymentProps } from '@basket/core/entities/Payment';
import type { IPaymentRepository } from '@basket/core/ports/IPaymentRepository';

const BATCH_SIZE = 500;

export interface LoadPaymentsInput {
  rows: AsyncIterable<PaymentProps>;
  onProgress?: (loaded: number) => void;
}

export interface LoadPaymentsResult {
  inserted: number;
  rejected: number;
}

export class LoadPaymentsFromCsvUseCase {
  constructor(private readonly payments: IPaymentRepository) {}

  async execute(input: LoadPaymentsInput): Promise<LoadPaymentsResult> {
    let buffer: PaymentProps[] = [];
    let inserted = 0;

    for await (const row of input.rows) {
      buffer.push(row);
      if (buffer.length >= BATCH_SIZE) {
        inserted += await this.payments.upsertMany(buffer);
        input.onProgress?.(inserted);
        buffer = [];
      }
    }
    if (buffer.length > 0) {
      inserted += await this.payments.upsertMany(buffer);
      input.onProgress?.(inserted);
    }
    return { inserted, rejected: 0 };
  }
}
