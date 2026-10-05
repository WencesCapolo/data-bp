import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PaymentExportRow } from '@basket/core/ports/IPaymentExportSource';
import {
  MercadoPagoAllTransactionsExport,
  repairJsonFields,
} from './MercadoPagoAllTransactionsExport';

// Column order as the real report has it: METADATA, then the taxes blob, then
// OPERATION_TAGS, with money columns after it that a shifted parse would misread.
const HEADER =
  'TRANSACTION_DATE,SOURCE_ID,TRANSACTION_TYPE,TRANSACTION_AMOUNT,TRANSACTION_CURRENCY,' +
  'FEE_AMOUNT,METADATA,TAXES_AMOUNT,TAXES_DISAGGREGATED,OPERATION_TAGS,SETTLEMENT_NET_AMOUNT,PAYER_NAME';

const META_SUB = '"[{"available_tries":3,"preapproval_id":"58ab149f8233488886652475d6490649"}]"';
const TAXES = '"[{"financial_entity":"caba","amount":"-402.97","detail":"tax_withholding"}]"';
const COUPON = '[{"amount":"-6499.50","coupon_type":"coupon"}]';
const COUPON_BACK = '[{"amount":"6499.50","coupon_type":"coupon"}]';

async function readAll(csv: string): Promise<PaymentExportRow[]> {
  const path = join(mkdtempSync(join(tmpdir(), 'allreport-')), 'ALLReport.csv');
  writeFileSync(path, csv);
  const rows: PaymentExportRow[] = [];
  for await (const row of new MercadoPagoAllTransactionsExport(path).stream()) rows.push(row);
  return rows;
}

describe('repairJsonFields', () => {
  it('doubles the inner quotes of a quoted blob', () => {
    expect(repairJsonFields('a,"[{"k":"v"}]",b')).toBe('a,"[{""k"":""v""}]",b');
  });

  it('quotes a bare blob, the way MP writes OPERATION_TAGS', () => {
    expect(repairJsonFields(`a,${COUPON},b`)).toBe(
      'a,"[{""amount"":""-6499.50"",""coupon_type"":""coupon""}]",b',
    );
  });

  it('quotes a bare blob at the end of a line', () => {
    expect(repairJsonFields(`a,[{"k":"v"}]\nb`)).toBe('a,"[{""k"":""v""}]"\nb');
  });

  it('leaves a quoted field that merely contains [{ alone', () => {
    expect(repairJsonFields('a,"see [{x}] here",b')).toBe('a,"see [{x}] here",b');
  });
});

describe('MercadoPagoAllTransactionsExport', () => {
  // Real shape (2026-10-01 file): a 50% coupon. TRANSACTION_AMOUNT is the list
  // price; fee, taxes and net are on what the buyer paid.
  const charge =
    `2026-10-01T10:00:00.000-03:00,24401417,SETTLEMENT,12999.00,ARS,-416.81,` +
    `${META_SUB},-402.97,${TAXES},${COUPON},5679.72,`;
  const plain =
    `2026-10-01T11:00:00.000-03:00,24401418,SETTLEMENT,500.00,ARS,-30.00,` +
    `"[{}]",0.00,"[{}]",,470.00,`;

  it('reads a coupon Pago without shifting the columns after OPERATION_TAGS', async () => {
    const rows = await readAll(`${HEADER}\n${charge}\n${plain}\n`);
    const coupon = rows.find((r) => r.platformPaymentId === '24401417');

    expect(rows).toHaveLength(2);
    expect(coupon).toMatchObject({
      feeAmount: 416.81,
      taxAmount: 402.97,
      netAmount: 5679.72,
      subscriptionId: '58ab149f8233488886652475d6490649',
    });
  });

  it('counts what the buyer paid, not the list price, so the identity closes', async () => {
    const [coupon] = await readAll(`${HEADER}\n${charge}\n`);

    expect(coupon.grossAmount).toBe(6499.5);
    expect(coupon.grossAmount - coupon.refundedAmount - coupon.feeAmount - (coupon.taxAmount ?? 0))
      .toBeCloseTo(coupon.netAmount, 2);
  });

  it('refunds a coupon Pago by what was paid', async () => {
    const refund =
      `2026-10-02T10:00:00.000-03:00,24401417,REFUND,-12999.00,ARS,416.81,` +
      `${META_SUB},402.97,${TAXES},${COUPON_BACK},-5679.72,`;
    const [op] = await readAll(`${HEADER}\n${charge}\n${refund}\n`);

    expect(op).toMatchObject({ grossAmount: 6499.5, refundedAmount: 6499.5, netAmount: 0, status: 'refunded' });
  });
});
