import { desc } from 'drizzle-orm';
import { db, type Db } from '@shared/db/client';
import { basketPaymentUploads } from '../schema';

/** What one confirmed Upload is worth recording. See docs/adr/0004. */
export interface PaymentUploadRecord {
  /** Email of the Analyst who confirmed it, or the automation that did. */
  uploadedBy: string;
  filename: string;
  byteSize: number;
  rowTotal: number;
  rowsIngested: number;
  rowsSkipped: number;
  windowFrom: Date | null;
  windowTo: Date | null;
  /** Non-null when the sync that consumed this Upload failed. */
  error: string | null;
}

export interface PaymentUploadEntry extends PaymentUploadRecord {
  id: number;
  createdAt: Date;
}

/** Postgres `undefined_table` — the Upload migration has not been applied yet. */
const UNDEFINED_TABLE = '42P01';

function isMissingTable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === UNDEFINED_TABLE;
}

export class DrizzlePaymentUploadRepository {
  constructor(private readonly database: Db = db) {}

  async record(entry: PaymentUploadRecord): Promise<void> {
    await this.database.insert(basketPaymentUploads).values({
      uploadedBy: entry.uploadedBy,
      filename: entry.filename,
      byteSize: entry.byteSize,
      rowTotal: entry.rowTotal,
      rowsIngested: entry.rowsIngested,
      rowsSkipped: entry.rowsSkipped,
      windowFrom: entry.windowFrom,
      windowTo: entry.windowTo,
      error: entry.error,
    });
  }

  /**
   * Most recent Upload, for the modal's "last upload" line. Returns null when
   * the table does not exist yet, so a pending migration cannot break the modal.
   */
  async findLatest(): Promise<PaymentUploadEntry | null> {
    try {
      const rows = await this.database
        .select()
        .from(basketPaymentUploads)
        .orderBy(desc(basketPaymentUploads.createdAt), desc(basketPaymentUploads.id))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        uploadedBy: row.uploadedBy,
        filename: row.filename,
        byteSize: row.byteSize,
        rowTotal: row.rowTotal,
        rowsIngested: row.rowsIngested,
        rowsSkipped: row.rowsSkipped,
        windowFrom: row.windowFrom,
        windowTo: row.windowTo,
        error: row.error,
        createdAt: row.createdAt,
      };
    } catch (err) {
      if (isMissingTable(err)) return null;
      throw err;
    }
  }
}
