import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import type {
  IMaterializedViewRepository,
  MatViewName,
  RefreshResult,
} from '@basket/core/ports/IMaterializedViewRepository';

const ALL_VIEWS: MatViewName[] = [
  'basket_mat_daily_active',
  'basket_mat_monthly_lifecycle',
  'basket_mat_team_monthly',
  'basket_mat_team_daily',
  'basket_mat_revenue_daily',
  'basket_mat_gateway_net_daily',
  'basket_mat_fixture_ranges',
  // The subscriber lifecycle /financiero draws, migration 0019. Off the Pagos
  // view like the first two, so they refresh after them for no reason but order.
  'basket_mat_subscriber_days',
  'basket_mat_subscriber_months',
  'basket_mat_subscription_last_charge',
  'basket_mat_subscriber_lifetime',
];

export class DrizzleMaterializedViewRepository implements IMaterializedViewRepository {
  constructor(private readonly conn: Db = db) {}

  async refresh(view: MatViewName, concurrent: boolean): Promise<RefreshResult> {
    const startedAt = Date.now();
    const kw = concurrent ? 'CONCURRENTLY' : '';
    await this.conn.execute(sql.raw(`REFRESH MATERIALIZED VIEW ${kw} ${view}`));
    const rows = await this.conn.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM ${view}`));
    const rowCount = (rows as unknown as Array<{ c: number }>)[0].c;
    return { view, durationMs: Date.now() - startedAt, rowCount };
  }

  async refreshAll(concurrent: boolean): Promise<RefreshResult[]> {
    const out: RefreshResult[] = [];
    for (const v of ALL_VIEWS) {
      out.push(await this.refresh(v, concurrent));
    }
    return out;
  }
}
