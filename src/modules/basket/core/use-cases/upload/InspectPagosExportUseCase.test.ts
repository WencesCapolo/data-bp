import { describe, expect, it } from 'vitest';
import { PAYMENT_UPLOAD_COLUMNS, type PaymentUploadRow } from '@basket/core/dtos/PaymentUploadDTO';
import type { IPagosUploadLookups } from '@basket/core/ports/IUploadLookups';
import { InspectPagosExportUseCase } from './InspectPagosExportUseCase';

const HEADER = PAYMENT_UPLOAD_COLUMNS.map((c) => c.toLowerCase());
const STAGED = { uploadId: 'u-1', filename: 'payments.csv', byteSize: 1234 };

function row(over: Partial<PaymentUploadRow>): PaymentUploadRow {
  return {
    id: '1', user_id: '10', firstname: '', lastname: '', status: '1', status_detail: 'approved',
    email: '', country: '', platform_payment_id: '', platform: '0', amount: '16999',
    currency: 'ARS', recurrent: '30', created: '01/08/2026 10:00', payment_country: '',
    ...over,
  };
}

async function* rows(list: PaymentUploadRow[]): AsyncGenerator<PaymentUploadRow> {
  for (const r of list) yield r;
}

function lookups(over: Partial<IPagosUploadLookups> = {}): IPagosUploadLookups {
  return {
    knownSubscriberIds: async (ids) => new Set(ids),
    monthlyTierCurrencies: async () => new Set(['ars', 'clp']),
    ...over,
  };
}

/** Five Pagos: three approved, one rejected, one pending; two Providers; one
 *  Subscriber the mirror does not know; one monthly Pago in a currency with no
 *  Tier. Late-evening stamp on the first, so the Window crosses midnight in UTC. */
const FIVE = [
  row({ id: '1', user_id: '10', created: '28/07/2026 22:30' }),
  row({ id: '2', user_id: '11', platform: '4', currency: 'USD', amount: '9.99' }),
  row({ id: '3', user_id: '12', status: '0', status_detail: 'rejected' }),
  row({ id: '4', user_id: '99', status: '0', status_detail: 'pending', created: '04/08/2026 08:00' }),
  row({ id: '5', user_id: '10', recurrent: '365', created: '02/08/2026 12:00' }),
];

describe('InspectPagosExportUseCase', () => {
  it('measures the Window on the panel clock, the same one the mapper writes', async () => {
    const r = await new InspectPagosExportUseCase(lookups()).execute({ staged: STAGED, header: HEADER, rows: rows(FIVE) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.windowFrom).toBe('2026-07-29T01:30:00.000Z');
    expect(r.preview.windowTo).toBe('2026-08-04T11:00:00.000Z');
    expect(r.preview.windowDays).toBe(6);
  });

  it('counts rows, Providers and the not-approved split', async () => {
    const r = await new InspectPagosExportUseCase(lookups()).execute({ staged: STAGED, header: HEADER, rows: rows(FIVE) });
    if (!r.ok) throw new Error('rejected');
    expect(r.preview).toMatchObject({
      uploadId: 'u-1', filename: 'payments.csv', byteSize: 1234,
      rowTotal: 5, approved: 3, failed: 2, rejected: 1, pending: 1, otherNotApproved: 0,
      byProvider: { MercadoPago: 4, Stripe: 1 },
    });
  });

  it('warns about unknown Subscribers and currencies with no Tier', async () => {
    const r = await new InspectPagosExportUseCase(
      lookups({ knownSubscriberIds: async (ids) => new Set(ids.filter((id) => id !== 99)) }),
    ).execute({ staged: STAGED, header: HEADER, rows: rows(FIVE) });
    if (!r.ok) throw new Error('rejected');
    expect(r.preview.wouldSkip).toBe(1);
    expect(r.preview.warnings.map((w) => w.code)).toEqual(['unknown_subscribers', 'unmapped_price_points']);
    expect(r.preview.warnings[1].count).toBe(1); // the USD monthly row
  });

  it('stays silent on what it could not ask', async () => {
    const r = await new InspectPagosExportUseCase(
      lookups({ knownSubscriberIds: async () => null, monthlyTierCurrencies: async () => null }),
    ).execute({ staged: STAGED, header: HEADER, rows: rows(FIVE) });
    if (!r.ok) throw new Error('rejected');
    expect(r.preview.wouldSkip).toBe(0);
    expect(r.preview.warnings).toEqual([]);
  });

  it('flags a file with no failed Pago as the Suscripciones Export', async () => {
    const r = await new InspectPagosExportUseCase(
      lookups({ monthlyTierCurrencies: async () => new Set(['ars', 'usd']) }),
    ).execute({ staged: STAGED, header: HEADER, rows: rows(FIVE.filter((x) => x.status === '1')) });
    if (!r.ok) throw new Error('rejected');
    expect(r.preview.warnings.map((w) => w.code)).toEqual(['looks_like_subscriptions']);
  });

  it('rejects a wrong header and an empty file', async () => {
    const uc = new InspectPagosExportUseCase(lookups());
    const bad = await uc.execute({ staged: STAGED, header: ['id', 'nope'], rows: rows(FIVE) });
    expect(bad).toMatchObject({ ok: false, rejection: { error: 'bad_header' } });
    const none = await uc.execute({ staged: STAGED, header: null, rows: rows([]) });
    expect(none).toMatchObject({ ok: false, rejection: { error: 'bad_header' } });
    const empty = await uc.execute({ staged: STAGED, header: HEADER, rows: rows([]) });
    expect(empty).toMatchObject({ ok: false, rejection: { error: 'empty' } });
  });
});
