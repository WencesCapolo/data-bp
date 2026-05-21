import { sql } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { chunk } from '@shared/lib/chunk';
import type { ISheetDataMasterRepository } from '@basket/core/ports/ISheetDataMasterRepository';
import type { TeamMasterRow, EnumRow } from '@basket/infrastructure/sync/sheetDataMapper';
import { basketTeamMaster, basketCambiosEnum, basketDiasEnum } from '../schema';

const BATCH = 500;

export class DrizzleSheetDataMasterRepository implements ISheetDataMasterRepository {
  constructor(private readonly database: Db = db) {}

  async upsertTeams(rows: TeamMasterRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const dedup = new Map<string, TeamMasterRow>();
    for (const r of rows) dedup.set(`${r.workbookLabel}|${r.nameFull}`, r);
    let total = 0;
    for (const part of chunk([...dedup.values()], BATCH)) {
      await this.database
        .insert(basketTeamMaster)
        .values(part.map((r) => ({ ...r, syncedAt: sql`NOW()` })))
        .onConflictDoUpdate({
          target: [basketTeamMaster.workbookLabel, basketTeamMaster.nameFull],
          set: {
            nameShort: sql`excluded.name_short`,
            siglas: sql`excluded.siglas`,
            stadium: sql`excluded.stadium`,
            city: sql`excluded.city`,
            officialPage: sql`excluded.official_page`,
            syncedAt: sql`NOW()`,
          },
        });
      total += part.length;
    }
    return total;
  }

  async upsertCambios(rows: EnumRow[]): Promise<number> {
    return this.upsertEnum(rows, basketCambiosEnum);
  }

  async upsertDias(rows: EnumRow[]): Promise<number> {
    return this.upsertEnum(rows, basketDiasEnum);
  }

  private async upsertEnum(
    rows: EnumRow[],
    table: typeof basketCambiosEnum | typeof basketDiasEnum,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const dedup = new Map<string, EnumRow>();
    for (const r of rows) dedup.set(`${r.workbookLabel}|${r.label}`, r);
    let total = 0;
    for (const part of chunk([...dedup.values()], BATCH)) {
      await this.database
        .insert(table)
        .values(part.map((r) => ({ ...r, syncedAt: sql`NOW()` })))
        .onConflictDoUpdate({
          target: [table.workbookLabel, table.label],
          set: {
            position: sql`excluded.position`,
            syncedAt: sql`NOW()`,
          },
        });
      total += part.length;
    }
    return total;
  }
}
