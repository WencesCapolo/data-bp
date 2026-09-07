// The Pagos Upload, end to end, behind two calls: inspect a staged Export and
// say what confirming would do; confirm it and make it land. Everything ADR 0001
// and ADR 0004 hang on the Upload — the preview, the provenance row, the
// single-use handle, one Sync at a time — lives here rather than in whichever
// route or script happens to be calling.
//
// The CLI ingests through the same `ingestFile` the confirm step uses, so a file
// brought in from a shell and the same file confirmed in the modal go through
// the same steps: Pagos, amount realignment, mat views, provenance.

import { statSync } from 'node:fs';
import type { RunSyncResult, RunSyncUseCase } from '@basket/core/use-cases/sync/RunSyncUseCase';
import {
  InspectPagosExportUseCase,
  type PagosInspection,
  type StagedExportFacts,
} from '@basket/core/use-cases/upload/InspectPagosExportUseCase';
import type { IUploadProvenanceRepository } from '@basket/core/ports/IUploadProvenanceRepository';
import type { PaymentUploadRow, UploadResultDTO } from '@basket/core/dtos/PaymentUploadDTO';
import { DrizzlePaymentUploadRepository } from '@basket/infrastructure/db/repositories/DrizzlePaymentUploadRepository';
import { composeRunSync } from '@basket/infrastructure/sync/composeRunSync';
import { streamCsvFile } from '@shared/lib/csvStream';
import {
  deleteStagedFile,
  readStagedHead,
  rememberUploadMeta,
  resolveStagedPath,
  sniffBinary,
  takeUploadMeta,
  type StagedFile,
} from '@shared/lib/uploadStaging';
import { DrizzlePagosUploadLookups } from './DrizzleUploadLookups';

export interface PagosUploadIntakeDeps {
  inspect: InspectPagosExportUseCase;
  uploads: IUploadProvenanceRepository;
  /** The Sync that consumes one Pagos Export: payments → realign → refresh. */
  composeUploadSync: (paymentsCsvPath: string) => Promise<RunSyncUseCase>;
}

/** What the preview measured, or what the caller knows when there was no preview. */
export interface PagosExportFacts {
  filename: string;
  byteSize: number;
  rowTotal: number;
  windowFrom: Date | null;
  windowTo: Date | null;
}

export interface PagosIngestInput extends PagosExportFacts {
  path: string;
  /** Who the provenance row names: an Analyst's email or an automation. */
  actor: string;
}

export type PagosIngestOutcome =
  | { ok: true; result: RunSyncResult; upload: Omit<UploadResultDTO, 'uploadId'> }
  | { ok: false; error: string };

export interface PagosConfirmInput {
  uploadId: string;
  actor: string;
  /** Echoed from the browser; used only when the server's own memory of the
   *  preview was lost to a restart. */
  fallback?: Partial<Pick<PagosExportFacts, 'filename' | 'rowTotal'>> & {
    windowFrom?: string | null;
    windowTo?: string | null;
  };
}

export type PagosConfirmStart =
  | { status: 'unknown_upload' }
  | { status: 'already_running' }
  | { status: 'started'; run: Promise<PagosIngestOutcome> };

export class PagosUploadIntake {
  private inFlight: Promise<PagosIngestOutcome> | null = null;

  constructor(private readonly deps: PagosUploadIntakeDeps) {}

  /** A confirm is running. The Sync writes every table, so there is one at a time. */
  get running(): boolean {
    return this.inFlight !== null;
  }

  /**
   * Preview a staged Export. A rejection drops the staged file; a preview keeps
   * it and remembers what was measured, so the confirm step writes provenance
   * from the server's own numbers rather than from what the browser echoes back.
   */
  async inspect(staged: StagedFile, filename: string): Promise<PagosInspection> {
    let keep = false;
    try {
      const inspection = await this.inspectPath(staged.path, {
        uploadId: staged.uploadId,
        filename,
        byteSize: staged.byteSize,
      });
      if (inspection.ok) {
        keep = true;
        const p = inspection.preview;
        rememberUploadMeta(p.uploadId, {
          filename: p.filename,
          byteSize: p.byteSize,
          rowTotal: p.rowTotal,
          windowFrom: p.windowFrom,
          windowTo: p.windowTo,
        });
      }
      return inspection;
    } finally {
      if (!keep) await deleteStagedFile(staged.path);
    }
  }

  /** The preview for any file on disk. Nothing is remembered or deleted. */
  async inspectPath(path: string, facts: StagedExportFacts): Promise<PagosInspection> {
    const head = await readStagedHead(path);
    const binary = sniffBinary(head);
    if (binary === 'xlsx' || binary === 'xls') {
      return rejection(
        'not_csv',
        'El archivo es un libro de Excel, no un CSV (aunque la extensión diga .csv). ' +
          'En el Panel de Control elegí descargar el Export en formato CSV y volvé a subirlo.',
      );
    }
    if (binary === 'binary') {
      return rejection(
        'not_csv',
        'El contenido del archivo no es texto CSV. Descargá el Export en formato CSV y volvé a subirlo.',
      );
    }
    return this.deps.inspect.execute({
      staged: facts,
      header: parseHeader(head),
      // The Export drops a trailing empty `payment_country`, so rows can be 14
      // fields wide; streamCsvFile already sets relax_column_count for that.
      rows: streamCsvFile<PaymentUploadRow>(path, { delimiter: ',', bom: true }),
    });
  }

  /**
   * Consume a previewed Upload. Answers as soon as the run has started — a full
   * refresh of the mat views is longer than a request should hang — and hands
   * back the promise so a caller can wait on it or report on it. The handle is
   * single-use: the staged file is deleted when the run ends, however it ends.
   */
  async confirm(input: PagosConfirmInput): Promise<PagosConfirmStart> {
    const path = resolveStagedPath(input.uploadId);
    if (!path || !statSync(path, { throwIfNoEntry: false })) return { status: 'unknown_upload' };
    if (this.inFlight) return { status: 'already_running' };

    // Prefer what the preview measured over what the browser reports.
    const measured = takeUploadMeta(input.uploadId);
    const fallback = input.fallback ?? {};
    const facts: PagosExportFacts = {
      filename: measured?.filename ?? fallback.filename ?? 'export.csv',
      byteSize: measured?.byteSize ?? statSync(path, { throwIfNoEntry: false })?.size ?? 0,
      rowTotal: measured?.rowTotal ?? fallback.rowTotal ?? 0,
      windowFrom: toDate(measured?.windowFrom ?? fallback.windowFrom),
      windowTo: toDate(measured?.windowTo ?? fallback.windowTo),
    };

    const run = this.ingestFile({ path, actor: input.actor, ...facts }).finally(async () => {
      this.inFlight = null;
      await deleteStagedFile(path);
    });
    this.inFlight = run;
    return { status: 'started', run };
  }

  /**
   * Ingest one Pagos Export from disk and record that it happened. Never throws:
   * a failed run is an outcome with its error, and the provenance row carries the
   * same error, because the mirror may be half-written by then and a row that
   * says so is worth more than an exception nobody stored.
   */
  async ingestFile(input: PagosIngestInput): Promise<PagosIngestOutcome> {
    let outcome: PagosIngestOutcome;
    try {
      const sync = await this.deps.composeUploadSync(input.path);
      const result = await sync.execute();
      outcome = {
        ok: true,
        result,
        upload: {
          rowTotal: input.rowTotal,
          rowsIngested: result.syncedPayments,
          rowsSkipped: result.skippedPayments,
        },
      };
    } catch (err) {
      outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    // Provenance must not be what breaks the run — the mirror is already written
    // by the time we get here, and the table may predate its migration.
    await this.deps.uploads
      .record({
        uploadedBy: input.actor,
        filename: input.filename,
        byteSize: input.byteSize,
        rowTotal: input.rowTotal,
        rowsIngested: outcome.ok ? outcome.result.syncedPayments : 0,
        rowsSkipped: outcome.ok ? outcome.result.skippedPayments : 0,
        windowFrom: input.windowFrom,
        windowTo: input.windowTo,
        error: outcome.ok ? null : outcome.error,
      })
      .catch((err) => console.error('payment upload provenance not recorded:', (err as Error).message));

    return outcome;
  }
}

function rejection(error: 'not_csv', message: string): PagosInspection {
  return { ok: false, rejection: { error, message } };
}

function parseHeader(head: Buffer): string[] | null {
  const text = head.toString('utf8').replace(/^﻿/, '');
  const nl = text.search(/\r?\n/);
  const line = nl === -1 ? text : text.slice(0, nl);
  if (!line.trim()) return null;
  return line.split(',').map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase());
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

let instance: PagosUploadIntake | null = null;

/**
 * The one intake per process. The lock is a field on it, which is why there is
 * one: a second instance would be a second "one Sync at a time".
 */
export function pagosUploadIntake(): PagosUploadIntake {
  instance ??= new PagosUploadIntake({
    inspect: new InspectPagosExportUseCase(new DrizzlePagosUploadLookups()),
    uploads: new DrizzlePaymentUploadRepository(),
    composeUploadSync: (paymentsCsvPath) => composeRunSync({ paymentsCsvPath, scope: 'upload' }),
  });
  return instance;
}
