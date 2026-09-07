import { describe, expect, it } from 'vitest';
import { moneyMoved } from './MercadoPagoFeeFetcher';

describe('MercadoPagoFeeFetcher.moneyMoved', () => {
  it('keeps every state in which the collector was actually paid', () => {
    for (const status of ['approved', 'refunded', 'charged_back', 'in_mediation']) {
      expect(moneyMoved({ status })).toBe(true);
    }
  });

  it('drops attempts that never captured — a rejected card is not a 100% fee', () => {
    for (const status of ['rejected', 'cancelled', 'pending', 'in_process', 'authorized']) {
      expect(moneyMoved({ status })).toBe(false);
    }
  });
});
