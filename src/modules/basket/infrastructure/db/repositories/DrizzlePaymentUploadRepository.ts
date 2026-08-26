import { desc, inArray } from 'drizzle-orm';
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

/**
 * Errors that are verdicts on a file rather than accidents of a run. Written by
 * the inbox ingest as `<FeeUploadRejectionCode>: <message>`.
 */
const SHAPE_VERDICT = /^(bad_format|bad_header|empty|invariant_broken|implausible_amounts|unknown_source):/;

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
   * What happened to these filenames last time, so the SFTP inbox can leave both
   * ingested and structurally-refused files alone.
   *
   * `ingested` — a row with no error. `rejected` — a row whose error is a verdict
   * on the file's *shape*, which will read the same way on every future run, so
   * re-reading it every six hours would only add a provenance row per run. Any
   * other error is a crash rather than a verdict and is deliberately absent from
   * the map: those files are retried.
   *
   * Latest row wins, because a file re-delivered under the same name and ingested
   * successfully must not stay marked rejected.
   *
   * Empty when the table does not exist yet, which makes the caller re-read
   * everything rather than skip everything — the safe direction, since the
   * upsert is idempotent.
   */
  async filenameOutcomes(names: string[]): Promise<Map<string, 'ingested' | 'rejected'>> {
    const out = new Map<string, 'ingested' | 'rejected'>();
    if (names.length === 0) return out;
    try {
      const rows = await this.database
        .select({
          filename: basketPaymentUploads.filename,
          error: basketPaymentUploads.error,
          id: basketPaymentUploads.id,
        })
        .from(basketPaymentUploads)
        .where(inArray(basketPaymentUploads.filename, names))
        .orderBy(basketPaymentUploads.id);
      for (const row of rows) {
        if (row.error == null) out.set(row.filename, 'ingested');
        else if (SHAPE_VERDICT.test(row.error)) out.set(row.filename, 'rejected');
        else out.delete(row.filename);
      }
      return out;
    } catch (err) {
      if (isMissingTable(err)) return out;
      throw err;
    }
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
