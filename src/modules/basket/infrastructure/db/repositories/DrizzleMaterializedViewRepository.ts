import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import type {
  IMaterializedViewRepository,
  MatViewName,
  RefreshResult,
} from '@basket/core/ports/IMaterializedViewRepository';
import { ALL_VIEWS, ANALYZED_TABLES } from './matViewOrder';

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
    for (const t of [...ANALYZED_TABLES, ...ALL_VIEWS]) {
      await this.conn.execute(sql.raw(`ANALYZE ${t}`));
    }
    return out;
  }
}
