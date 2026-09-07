/**
 * `basket_payment_uploads`: one row per Export that entered the mirror, whoever
 * brought it — the Upload screen, the CLI, the SFTP inbox. "Has this file been
 * ingested" is a question with exactly one answer and it is provenance's job to
 * hold it. See docs/adr/0004.
 */
export interface UploadProvenanceEntry {
  /** Email of the Analyst who confirmed it, or the automation that did. */
  uploadedBy: string;
  filename: string;
  byteSize: number;
  rowTotal: number;
  rowsIngested: number;
  rowsSkipped: number;
  windowFrom: Date | null;
  windowTo: Date | null;
  /** Non-null when the ingest that consumed this Export failed or refused it. */
  error: string | null;
}

export interface IUploadProvenanceRepository {
  record(entry: UploadProvenanceEntry): Promise<void>;
  /** What happened to these filenames last time: ingested, or refused for its
   *  shape. Absent means never seen, or seen and crashed — both worth retrying. */
  filenameOutcomes(names: string[]): Promise<Map<string, 'ingested' | 'rejected'>>;
}
