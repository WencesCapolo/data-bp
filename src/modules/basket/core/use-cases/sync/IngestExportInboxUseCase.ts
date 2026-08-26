import type { IExportInbox, InboxFile } from '@basket/core/ports/IExportInbox';
import type { IPaymentExportSource } from '@basket/core/ports/IPaymentExportSource';
import type { FeeExportSourceSpec, FeeUploadRejectionCode } from '@basket/core/dtos/FeeUploadDTO';
import { checkFeeTotals, round2 } from '@basket/core/dtos/feeTotalsCheck';
import type { IngestPaymentExportUseCase } from './IngestPaymentExportUseCase';

/**
 * What the use case needs of `basket_payment_uploads`. The same table the Upload
 * screen and the CLI write, because "has this file been ingested" is a question
 * with exactly one answer and it is provenance's job to hold it.
 */
export interface ExportProvenanceStore {
  record(entry: {
    uploadedBy: string;
    filename: string;
    byteSize: number;
    rowTotal: number;
    rowsIngested: number;
    rowsSkipped: number;
    windowFrom: Date | null;
    windowTo: Date | null;
    error: string | null;
  }): Promise<void>;
  /** What happened to these filenames last time: ingested, or refused for its
   *  shape. Absent means never seen, or seen and crashed — both worth retrying. */
  filenameOutcomes(names: string[]): Promise<Map<string, 'ingested' | 'rejected'>>;
}

/** How a file is identified as an Export, and turned into rows. */
export type ExportSourceResolver = (
  file: InboxFile,
) => Promise<
  | { spec: FeeExportSourceSpec; source: IPaymentExportSource }
  | { error: FeeUploadRejectionCode; message: string }
>;

export type InboxFileOutcome = 'ingested' | 'skipped' | 'rejected' | 'failed';

export interface InboxFileResult {
  filename: string;
  outcome: InboxFileOutcome;
  /** Present on `rejected` and `failed`. Also written to the provenance row. */
  error: string | null;
  rows: number;
  upserted: number;
  grossTotal: number;
  feeTotal: number;
  taxTotal: number;
  netTotal: number;
  windowFrom: Date | null;
  windowTo: Date | null;
  durationMs: number;
}

export interface InboxIngestResult {
  origin: string;
  files: InboxFileResult[];
  /** Files in `done/` deleted by the retention sweep. */
  pruned: number;
  /** Set when the inbox itself could not be listed. No file was touched. */
  error: string | null;
}

export interface IngestExportInboxOptions {
  /** Re-ingest a file whose name is already recorded. For the case where MP
   *  regenerates a report under the name it used last time. */
  refresh?: boolean;
}

export interface IngestExportInboxDeps {
  inbox: IExportInbox;
  ingest: IngestPaymentExportUseCase;
  uploads: ExportProvenanceStore;
  resolve: ExportSourceResolver;
  /** Who the provenance row names. `cron:sync` from the cron, `script:…` from the CLI. */
  uploadedBy: string;
  /** Days of `done/` to keep. 0 keeps everything. */
  retentionDays?: number;
}

/**
 * Ingests every Export waiting in an inbox, then gets out of the way.
 *
 * Four things this owns, none of which the ingest use case should learn about:
 *
 *   - **Which files are new.** Answered by `basket_payment_uploads.filename`,
 *     which all three ingest paths already write. Re-ingesting is harmless — the
 *     upsert is keyed by the Provider's own id — so this is about not re-reading
 *     files, never about correctness.
 *   - **Refusing a file nobody looked at.** The screen shows a human a preview
 *     before anything is written; here there is no human, so the invariant and
 *     the ratio checks stand in for one. A file that fails them is left in the
 *     inbox with its reason in the provenance row.
 *   - **Per-file isolation.** A malformed file costs that file and nothing else:
 *     the handoff's never-fatal contract, which the cron step depends on.
 *   - **Where a file goes afterwards.** Ingested and rejected-for-shape move to
 *     `done/`; a file that *failed* — a crash, a broken pipe, a database that
 *     went away mid-flush — stays where it is so the next run retries it.
 *
 * Deliberately does not refresh the mat views. One refresh at the end belongs to
 * the caller, which in the cron's case is the refresh step it already runs.
 */
export class IngestExportInboxUseCase {
  constructor(private readonly deps: IngestExportInboxDeps) {}

  async execute(opts: IngestExportInboxOptions = {}): Promise<InboxIngestResult> {
    const { inbox, uploads } = this.deps;
    const result: InboxIngestResult = { origin: inbox.origin, files: [], pruned: 0, error: null };

    let waiting: InboxFile[];
    try {
      waiting = await inbox.list();
    } catch (err) {
      result.error = (err as Error).message;
      return result;
    }

    const settled = opts.refresh
      ? new Map<string, 'ingested' | 'rejected'>()
      : await uploads
          .filenameOutcomes(waiting.map((f) => f.name))
          .catch(() => new Map<string, 'ingested' | 'rejected'>());

    for (const file of waiting) {
      const before = settled.get(file.name);
      if (before === 'ingested') {
        result.files.push(blank(file.name, 'skipped', null));
        // Already ingested and still in the inbox means a previous run was
        // interrupted between the write and the move. Finish the move.
        await inbox.markDone(file).catch(() => {});
        continue;
      }
      if (before === 'rejected') {
        // Left where it is, deliberately: the inbox is what says what went
        // wrong, and a file refused for its shape will be refused identically
        // next run. Reported every run, recorded once.
        result.files.push(blank(file.name, 'skipped', 'refused previously; still in the inbox'));
        continue;
      }
      result.files.push(await this.ingestOne(file));
    }

    result.pruned = await inbox.prune(this.deps.retentionDays ?? 30).catch(() => 0);
    return result;
  }

  private async ingestOne(file: InboxFile): Promise<InboxFileResult> {
    const startedAt = Date.now();
    const { inbox, uploads } = this.deps;

    const record = async (entry: {
      rowTotal: number;
      rowsIngested: number;
      rowsSkipped: number;
      windowFrom: Date | null;
      windowTo: Date | null;
      error: string | null;
    }) => {
      // Provenance must not be what breaks the run: the rows are already in the
      // mirror by the time this is written, and a missing row costs a repeat
      // read next time, not a wrong figure.
      await uploads
        .record({
          uploadedBy: this.deps.uploadedBy,
          filename: file.name,
          byteSize: file.byteSize,
          ...entry,
        })
        .catch((err) => console.error(`provenance for ${file.name} failed:`, (err as Error).message));
    };

    let resolved;
    try {
      resolved = await this.deps.resolve(file);
    } catch (err) {
      await record({ rowTotal: 0, rowsIngested: 0, rowsSkipped: 0, windowFrom: null, windowTo: null, error: (err as Error).message });
      return blank(file.name, 'failed', (err as Error).message, Date.now() - startedAt);
    }

    if ('error' in resolved) {
      const message = `${resolved.error}: ${resolved.message}`;
      await record({ rowTotal: 0, rowsIngested: 0, rowsSkipped: 0, windowFrom: null, windowTo: null, error: message });
      // Left in the inbox on purpose: a directory with one file in it and an
      // error row against its name is the clearest thing an operator can be
      // handed. Provenance keeps it from being re-read on every run.
      return blank(file.name, 'rejected', message, Date.now() - startedAt);
    }

    try {
      // Measured before it is written, the way the screen's preview is: the
      // ratio check exists to catch a file whose amount columns moved, and a
      // mirror that has already swallowed those figures reports a wrong cost of
      // payments until the file is re-delivered. Reading a ~2 MB Export twice is
      // the cheaper half of that trade.
      const measured = await measureTotals(resolved.source);
      const bad = checkFeeTotals(resolved.spec, measured);
      if (bad) {
        const message = `${bad.error}: ${bad.message}`;
        await record({
          rowTotal: measured.rows, rowsIngested: 0, rowsSkipped: 0,
          windowFrom: null, windowTo: null, error: message,
        });
        return blank(file.name, 'rejected', message, Date.now() - startedAt);
      }

      const r = await this.deps.ingest.execute(resolved.source);
      const error = null;

      await record({
        rowTotal: r.rows,
        rowsIngested: r.upserted,
        rowsSkipped: r.skipped,
        windowFrom: r.from,
        windowTo: r.to,
        error,
      });
      await inbox.markDone(file).catch((err) => {
        console.error(`could not move ${file.name} to done/:`, (err as Error).message);
      });

      return {
        filename: file.name,
        outcome: 'ingested',
        error,
        rows: r.rows,
        upserted: r.upserted,
        grossTotal: round2(r.grossTotal),
        feeTotal: round2(r.feeTotal),
        taxTotal: round2(r.taxTotal),
        netTotal: round2(r.netTotal),
        windowFrom: r.from,
        windowTo: r.to,
        durationMs: r.durationMs,
      };
    } catch (err) {
      const message = (err as Error).message;
      await record({ rowTotal: 0, rowsIngested: 0, rowsSkipped: 0, windowFrom: null, windowTo: null, error: message });
      // Left in place on purpose: this is a crash, not a verdict on the file.
      return blank(file.name, 'failed', message, Date.now() - startedAt);
    }
  }
}

/**
 * Streams a source without writing anything, for the totals the plausibility
 * check needs. The adapters re-read their file on every `stream()` call, which is
 * what makes a measure-then-write pass possible at all.
 */
async function measureTotals(
  source: IPaymentExportSource,
): Promise<{ rows: number; gross: number; fee: number; tax: number; net: number; refunded: number }> {
  const t = { rows: 0, gross: 0, fee: 0, tax: 0, net: 0, refunded: 0 };
  for await (const row of source.stream()) {
    t.rows += 1;
    t.gross += row.grossAmount;
    t.fee += row.feeAmount;
    t.net += row.netAmount;
    t.refunded += row.refundedAmount;
    if (row.taxAmount != null) t.tax += row.taxAmount;
  }
  return t;
}

function blank(
  filename: string,
  outcome: InboxFileOutcome,
  error: string | null,
  durationMs = 0,
): InboxFileResult {
  return {
    filename, outcome, error,
    rows: 0, upserted: 0, grossTotal: 0, feeTotal: 0, taxTotal: 0, netTotal: 0,
    windowFrom: null, windowTo: null, durationMs,
  };
}
