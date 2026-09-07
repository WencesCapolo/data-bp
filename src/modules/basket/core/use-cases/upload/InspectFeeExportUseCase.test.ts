import { describe, expect, it } from 'vitest';
import { feeExportSource } from '@basket/core/dtos/FeeUploadDTO';
import type { IFeeUploadLookups } from '@basket/core/ports/IUploadLookups';
import type { IPaymentExportSource, PaymentExportRow } from '@basket/core/ports/IPaymentExportSource';
import { InspectFeeExportUseCase } from './InspectFeeExportUseCase';

const SPEC = feeExportSource('mercadopago_cobros')!;
const STAGED = { uploadId: 'u-2', filename: 'cobros.xlsx', byteSize: 2048 };

function row(over: Partial<PaymentExportRow>): PaymentExportRow {
  // 1.8% commission, ~5.5% withholding: what a real Cobros row looks like.
  return {
    platformPaymentId: 'op-1', grossAmount: 10_000, currency: 'ARS', feeAmount: 180,
    taxAmount: 550, netAmount: 9_270, refundedAmount: 0, status: 'approved',
    capturedAt: new Date('2026-08-01T12:00:00Z'), payerEmail: null, operationType: null,
    ...over,
  };
}

function source(list: PaymentExportRow[]): IPaymentExportSource {
  return {
    platform: 0, slug: 'mercadopago_cobros', origin: 'cobros.xlsx',
    async *stream() { for (const r of list) yield r; },
  };
}

function lookups(over: Partial<IFeeUploadLookups> = {}): IFeeUploadLookups {
  return {
    existingPagoIds: async (ids) => new Set(ids),
    existingFeeIds: async () => new Set(),
    ...over,
  };
}

const THREE = [
  row({ platformPaymentId: 'a' }),
  row({ platformPaymentId: 'b', capturedAt: new Date('2026-08-20T12:00:00Z') }),
  row({ platformPaymentId: 'b' }), // duplicate id: last one wins
];

describe('InspectFeeExportUseCase', () => {
  it('totals the file and reports the Window and the ratios', async () => {
    const r = await new InspectFeeExportUseCase(lookups()).execute({ staged: STAGED, spec: SPEC, header: SPEC.requiredColumns, source: source(THREE) });
    if (!r.ok) throw new Error(`rejected: ${r.rejection.error}`);
    expect(r.preview).toMatchObject({
      rows: 3, grossTotal: 30_000, feeTotal: 540, taxTotal: 1_650, netTotal: 27_810,
      feePct: 1.8, taxPct: 5.5, rowsWithTax: 3, currency: 'ARS',
      windowFrom: '2026-08-01T12:00:00.000Z', windowTo: '2026-08-20T12:00:00.000Z',
      matchedPagos: 2, alreadyIngested: 0, byStatus: { approved: 3 },
    });
    expect(r.preview.warnings.map((w) => w.code)).toEqual(['duplicate_ids']);
  });

  it('warns about ids with no Pago and ids already carrying a fee', async () => {
    const r = await new InspectFeeExportUseCase(
      lookups({ existingPagoIds: async () => new Set(['a']), existingFeeIds: async () => new Set(['b']) }),
    ).execute({ staged: STAGED, spec: SPEC, header: SPEC.requiredColumns, source: source(THREE) });
    if (!r.ok) throw new Error('rejected');
    expect(r.preview.warnings.map((w) => w.code)).toEqual(['unmatched_payments', 'already_ingested', 'duplicate_ids']);
  });

  it('refuses a file whose arithmetic does not close', async () => {
    const r = await new InspectFeeExportUseCase(lookups()).execute({
      staged: STAGED, spec: SPEC, header: SPEC.requiredColumns,
      source: source([row({ netAmount: 5_000 })]),
    });
    expect(r).toMatchObject({ ok: false, rejection: { error: 'invariant_broken' } });
  });

  it('refuses a header missing the machine names, and an empty file', async () => {
    const uc = new InspectFeeExportUseCase(lookups());
    expect(await uc.execute({ staged: STAGED, spec: SPEC, header: ['operation_id'], source: source(THREE) }))
      .toMatchObject({ ok: false, rejection: { error: 'bad_header' } });
    expect(await uc.execute({ staged: STAGED, spec: SPEC, header: SPEC.requiredColumns, source: source([]) }))
      .toMatchObject({ ok: false, rejection: { error: 'empty' } });
  });
});
