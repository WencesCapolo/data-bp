import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GatewayMovementProps } from '@basket/core/entities/GatewayMovement';
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

describe('MercadoPagoAllTransactionsExport movements', () => {
  // The real header leads with the three dates: when it happened, when MP
  // settled it, and when the money becomes available in the account.
  const HEADER_WITH_DATES =
    'TRANSACTION_DATE,SETTLEMENT_DATE,MONEY_RELEASE_DATE,SOURCE_ID,TRANSACTION_TYPE,' +
    'TRANSACTION_AMOUNT,TRANSACTION_CURRENCY,FEE_AMOUNT,METADATA,TAXES_AMOUNT,' +
    'TAXES_DISAGGREGATED,OPERATION_TAGS,SETTLEMENT_NET_AMOUNT';
  const settlement =
    '2026-10-01T10:00:00.000-03:00,2026-10-01T10:00:05.000-03:00,2026-10-15T10:00:05.000-03:00,' +
    `7001,SETTLEMENT,1000.00,ARS,-60.00,${META_SUB},-40.00,${TAXES},,900.00`;
  const refund =
    '2026-10-20T09:00:00.000-03:00,2026-10-20T09:00:01.000-03:00,2026-10-20T09:00:01.000-03:00,' +
    `7001,REFUND,-1000.00,ARS,60.00,${META_SUB},40.00,${TAXES},,-900.00`;
  // The monthly commission invoice: no type, no amount, only a debit.
  const adjustment =
    '2026-10-31T23:00:00.000-03:00,2026-10-31T23:00:00.000-03:00,2026-10-31T23:00:00.000-03:00,' +
    '9001,,0.00,ARS,-1500.00,"[{}]",0.00,"[{}]",,-1500.00';
  const unreleased =
    '2026-10-02T10:00:00.000-03:00,,,7002,SETTLEMENT,500.00,ARS,-30.00,"[{}]",0.00,"[{}]",,470.00';

  async function movementsOf(csv: string): Promise<GatewayMovementProps[]> {
    const path = join(mkdtempSync(join(tmpdir(), 'allreport-')), 'ALLReport.csv');
    writeFileSync(path, csv);
    const out: GatewayMovementProps[] = [];
    for await (const m of new MercadoPagoAllTransactionsExport(path).movements()) out.push(m);
    return out;
  }

  it('yields one movement per row, not one per operation', async () => {
    const out = await movementsOf(`${HEADER_WITH_DATES}\n${settlement}\n${refund}\n`);

    expect(out).toHaveLength(2);
    expect(out.map((m) => m.platformPaymentId)).toEqual(['7001', '7001']);
  });

  it('keeps the account frame: money in is positive, money out negative', async () => {
    const [charge, back] = await movementsOf(`${HEADER_WITH_DATES}\n${settlement}\n${refund}\n`);

    expect(charge).toMatchObject({ type: 'SETTLEMENT', netAmount: 900, currency: 'ARS' });
    expect(back).toMatchObject({ type: 'REFUND', netAmount: -900 });
  });

  it('dates each movement by when its money is released, not by when it was charged', async () => {
    const [charge] = await movementsOf(`${HEADER_WITH_DATES}\n${settlement}\n`);

    expect(charge.occurredAt?.toISOString()).toBe('2026-10-01T13:00:00.000Z');
    expect(charge.availableAt?.toISOString()).toBe('2026-10-15T13:00:05.000Z');
  });

  it('keeps the account adjustments the fee mirror leaves out, because they move cash', async () => {
    const [m] = await movementsOf(`${HEADER_WITH_DATES}\n${adjustment}\n`);

    expect(m).toMatchObject({ type: 'ADJUSTMENT', netAmount: -1500, platformPaymentId: '9001' });
  });

  it('leaves the release date empty when MP has not scheduled one', async () => {
    const [m] = await movementsOf(`${HEADER_WITH_DATES}\n${unreleased}\n`);

    expect(m.availableAt).toBeNull();
  });

  it('names a movement the same way in every file that carries it', async () => {
    const [a] = await movementsOf(`${HEADER_WITH_DATES}\n${settlement}\n`);
    const [b] = await movementsOf(`${HEADER_WITH_DATES}\n${unreleased}\n${settlement}\n`).then((ms) => ms.slice(1));
    const all = await movementsOf(`${HEADER_WITH_DATES}\n${settlement}\n${refund}\n${adjustment}\n`);

    expect(a.movementId).toBe(b.movementId);
    expect(new Set(all.map((m) => m.movementId)).size).toBe(3);
  });
});
