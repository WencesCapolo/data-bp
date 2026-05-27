import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import type { IPartidosNacionalRepository } from '@partidos/core/ports/IPartidosNacionalRepository';
import type { PartidoNacionalProps } from '@partidos/core/entities/PartidoNacional';
import { partidosNacional } from '../schema';

const CHUNK = 500;

function toIsoDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

export class DrizzlePartidosNacionalRepository implements IPartidosNacionalRepository {
  constructor(private readonly database: Db = db) {}

  async replaceAll(rows: PartidoNacionalProps[]): Promise<number> {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`TRUNCATE TABLE ${partidosNacional} RESTART IDENTITY`);
      if (rows.length === 0) return 0;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK).map((r) => ({
          season: r.season,
          monthYear: r.monthYear,
          weekRange: r.weekRange,
          weekStart: toIsoDate(r.weekStart),
          weekEnd: toIsoDate(r.weekEnd),
          isMonthTotal: r.isMonthTotal,
          control: r.control,
          org: r.org,
          league: r.league,
          total: r.total,
          tyc: r.tyc,
          directTv: r.directTv,
          bpEmitido: r.bpEmitido,
          bpProducido: r.bpProducido,
          externoProducido: r.externoProducido,
        }));
        await tx.insert(partidosNacional).values(chunk);
        inserted += chunk.length;
      }
      return inserted;
    });
  }

  async count(): Promise<number> {
    const rows = await this.database.execute<{ c: number }>(
      sql`SELECT COUNT(*)::int AS c FROM ${partidosNacional}`,
    );
    return (rows as unknown as Array<{ c: number }>)[0]?.c ?? 0;
  }
}
