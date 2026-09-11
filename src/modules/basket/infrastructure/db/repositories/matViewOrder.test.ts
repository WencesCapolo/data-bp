import { describe, expect, it } from 'vitest';
import { ALL_VIEWS } from './matViewOrder';

// The refresh order is a dependency order: a view that reads another must be
// rebuilt after it, or one Sync shows the new Pagos in one card and the old
// ones in the next.
const after = (view: string, source: string): boolean =>
  ALL_VIEWS.indexOf(view as (typeof ALL_VIEWS)[number]) > ALL_VIEWS.indexOf(source as (typeof ALL_VIEWS)[number]);

describe('materialized view refresh order', () => {
  it('lists every view once', () => {
    expect(new Set(ALL_VIEWS).size).toBe(ALL_VIEWS.length);
  });

  it('rebuilds the Pagos fact table before the windows that read it', () => {
    expect(ALL_VIEWS).toContain('basket_mat_payment_facts');
    expect(after('basket_mat_period_windows', 'basket_mat_payment_facts')).toBe(true);
  });

  it('carries the Economía views of migration 0021', () => {
    expect(ALL_VIEWS).toContain('basket_mat_fee_coverage');
    expect(ALL_VIEWS).toContain('basket_mat_period_windows');
  });
});
