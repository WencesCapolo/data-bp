import { describe, expect, it } from 'vitest';
import type { GatewayFeeProps } from '@basket/core/entities/GatewayFee';
import type { GatewayMovementProps } from '@basket/core/entities/GatewayMovement';
import type { IGatewayFeeRepository } from '@basket/core/ports/IGatewayFeeRepository';
import type { IGatewayMirrorRepository } from '@basket/core/ports/IGatewayMirror';
import type { IPaymentExportSource, PaymentExportRow } from '@basket/core/ports/IPaymentExportSource';
import { IngestPaymentExportUseCase } from './IngestPaymentExportUseCase';

const row: PaymentExportRow = {
  platformPaymentId: '1', grossAmount: 100, currency: 'ARS', feeAmount: 6, taxAmount: 4,
  netAmount: 90, refundedAmount: 0, status: 'approved', capturedAt: null,
  payerEmail: null, operationType: null,
};
const movement: GatewayMovementProps = {
  platform: 0, movementId: '1:SETTLEMENT:t:90.00', platformPaymentId: '1', type: 'SETTLEMENT',
  currency: 'ARS', netAmount: 90, occurredAt: null, availableAt: null,
};

function source(withMovements: boolean): IPaymentExportSource {
  const s: IPaymentExportSource = {
    platform: 0, slug: 'mercadopago', origin: 'test.csv',
    async *stream() { yield row; },
  };
  if (withMovements) s.movements = async function* () { yield movement; };
  return s;
}

function memory() {
  const fees: GatewayFeeProps[] = [];
  const movements: GatewayMovementProps[] = [];
  const feeRepo = {
    upsertMany: async (rows: GatewayFeeProps[]) => { fees.push(...rows); return rows.length; },
    count: async () => fees.length,
    coverage: async () => [],
  } as IGatewayFeeRepository;
  const movementRepo: IGatewayMirrorRepository<GatewayMovementProps> = {
    upsertMany: async (rows) => { movements.push(...rows); return rows.length; },
    count: async () => movements.length,
  };
  return { fees, movements, feeRepo, movementRepo };
}

describe('IngestPaymentExportUseCase', () => {
  it('stores the balance movements of an Export that offers them', async () => {
    const m = memory();
    const result = await new IngestPaymentExportUseCase(m.feeRepo, m.movementRepo).execute(source(true));

    expect(m.fees).toHaveLength(1);
    expect(m.movements).toEqual([movement]);
    expect(result.movements).toBe(1);
  });

  it('stores none from an Export that cannot date a release', async () => {
    const m = memory();
    const result = await new IngestPaymentExportUseCase(m.feeRepo, m.movementRepo).execute(source(false));

    expect(m.movements).toHaveLength(0);
    expect(result.movements).toBe(0);
  });
});
