// A fee Export Upload, end to end: inspect a staged file and say what confirming
// would write; confirm it into `basket_payment_fees`. Deliberately not the Sync
// (see the confirm route's note): a fee Export feeds one table and one view.
//
// The CLI's per-file path is `ingestFile` too, so the provenance row, the
// totals check and the view refresh are decided once.

import { statSync } from 'node:fs';
import {
  feeExportSource,
  type FeeExportSourceSpec,
  type FeeUploadRejection,
  type FeeUploadResultDTO,
} from '@basket/core/dtos/FeeUploadDTO';
import { checkFeeTotals } from '@basket/core/dtos/feeTotalsCheck';
import type { IUploadProvenanceRepository } from '@basket/core/ports/IUploadProvenanceRepository';
import type { IMaterializedViewRepository } from '@basket/core/ports/IMaterializedViewRepository';
import {
  IngestPaymentExportUseCase,
  type PaymentExportIngestResult,
} from '@basket/core/use-cases/sync/IngestPaymentExportUseCase';
import {
  InspectFeeExportUseCase,
  type FeeInspection,
} from '@basket/core/use-cases/upload/InspectFeeExportUseCase';
import type { StagedExportFacts } from '@basket/core/use-cases/upload/InspectPagosExportUseCase';
import { DrizzleGatewayFeeRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayFeeRepository';
import { DrizzleMaterializedViewRepository } from '@basket/infrastructure/db/repositories/DrizzleMaterializedViewRepository';
import { DrizzlePaymentUploadRepository } from '@basket/infrastructure/db/repositories/DrizzlePaymentUploadRepository';
import { createExportSource, readExportHeader } from '@basket/infrastructure/exports/resolveExportSource';
import {
  deleteStagedFile,
  readStagedHead,
  rememberUploadMeta,
  resolveStagedPath,
  sniffBinary,
  takeUploadMeta,
  type StagedFile,
} from '@shared/lib/uploadStaging';
import { DrizzleFeeUploadLookups } from './DrizzleUploadLookups';

/** The two views that read the fee mirror: the Pago-anchored headline and its
 *  complement (migration 0020). Always refreshed together — one without the
 *  other leaves counted + excluded ≠ mirror until the next cron. */
const GATEWAY_NET_VIEWS = ['basket_mat_gateway_net_daily', 'basket_mat_gateway_net_outside_pagos'] as const;

export interface FeeUploadIntakeDeps {
  inspect: InspectFeeExportUseCase;
  ingest: IngestPaymentExportUseCase;
  uploads: IUploadProvenanceRepository;
  matViews: IMaterializedViewRepository;
}

export interface FeeIngestInput {
  path: string;
  spec: FeeExportSourceSpec;
  filename: string;
  byteSize: number;
  actor: string;
  /** Rebuild the one view that reads fees. The CLI ingesting 27 files says no
   *  and refreshes once at the end. */
  refreshView?: boolean;
}

export interface FeeIngestOutcome {
  result: PaymentExportIngestResult;
  /** The totals check on what was actually written; recorded in provenance. */
  check: FeeUploadRejection | null;
  viewRefreshMs: number | null;
}

export interface FeeConfirmInput {
  uploadId: string;
  sourceId: string;
  actor: string;
  fallbackFilename?: string;
}

export type FeeConfirmOutcome =
  | { ok: true; body: FeeUploadResultDTO }
  | { ok: false; status: number; rejection: FeeUploadRejection | { error: 'already_running'; message: string } };

export class FeeUploadIntake {
  private inFlight: Promise<unknown> | null = null;

  constructor(private readonly deps: FeeUploadIntakeDeps) {}

  /** One ingest at a time. Two Exports of the same month landing concurrently
   *  would each be correct and would race on the same keys for no gain. */
  get running(): boolean {
    return this.inFlight !== null;
  }

  /** Preview a staged file. A rejection drops it; a preview keeps it. */
  async inspect(staged: StagedFile, filename: string, sourceId: string): Promise<FeeInspection> {
    let keep = false;
    try {
      const spec = feeExportSource(sourceId);
      if (!spec) return rejection('unknown_source', `No conozco el Export "${sourceId}".`);
      const inspection = await this.inspectPath(staged.path, spec, {
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
          rowTotal: p.rows,
          windowFrom: p.windowFrom,
          windowTo: p.windowTo,
        });
      }
      return inspection;
    } finally {
      if (!keep) await deleteStagedFile(staged.path);
    }
  }

  /** The preview for any file on disk, read as the given Export. */
  async inspectPath(path: string, spec: FeeExportSourceSpec, facts: StagedExportFacts): Promise<FeeInspection> {
    // The format is decided by the bytes, never by the name: the staged file has
    // no extension at all, and a .csv that is really a workbook is the single
    // most common way this Upload goes wrong. Unlike the Pagos Upload this one
    // must accept a workbook: MercadoPago's panel hands the Cobros Export back
    // as .xlsx.
    const signature = sniffBinary(await readStagedHead(path));
    if (signature === 'xls') {
      return rejection(
        'bad_format',
        'Es un libro de Excel viejo (.xls). Volvé a exportarlo desde el panel: ' +
          'MercadoPago entrega .xlsx, y también acepta CSV.',
      );
    }
    if (signature === 'binary') {
      return rejection('bad_format', 'El archivo no es ni un .xlsx ni un CSV de texto.');
    }
    const format: 'csv' | 'xlsx' = signature === 'xlsx' ? 'xlsx' : 'csv';

    const header = await readExportHeader(path, format);
    // Which Export this is was answered by the person, in the picker; the reader
    // comes from the registry so the screen and the SFTP inbox cannot drift into
    // reading the same file two different ways.
    const source = createExportSource(spec.id, path, format, facts.filename);
    if (!source) return rejection('unknown_source', `No tengo lector para el Export "${spec.id}".`);

    return this.deps.inspect.execute({ staged: facts, spec, header, source });
  }

  /** Consume a previewed Upload. The handle is single-use either way: a failed
   *  ingest is re-run by uploading again, never by re-confirming a handle whose
   *  file may be half consumed. */
  async confirm(input: FeeConfirmInput): Promise<FeeConfirmOutcome> {
    const spec = feeExportSource(input.sourceId);
    if (!spec) return refuse(400, 'unknown_source', `No conozco el Export "${input.sourceId}".`);

    const path = resolveStagedPath(input.uploadId);
    if (!path) return refuse(400, 'expired', 'El identificador de la carga no es válido.');

    if (this.inFlight) {
      return {
        ok: false,
        status: 409,
        rejection: { error: 'already_running', message: 'Ya hay una carga de comisiones en curso.' },
      };
    }

    const meta = takeUploadMeta(input.uploadId);
    const filename = meta?.filename ?? input.fallbackFilename ?? 'export';

    const run = (async (): Promise<FeeConfirmOutcome> => {
      if (!statSync(path, { throwIfNoEntry: false })) {
        return refuse(
          400,
          'expired',
          'El archivo ya no está en el servidor. Las cargas sin confirmar se borran a la media hora: ' +
            'volvé a subirlo.',
        );
      }
      const { result, viewRefreshMs } = await this.ingestFile({
        path,
        spec,
        filename,
        byteSize: meta?.byteSize ?? 0,
        actor: input.actor,
        refreshView: true,
      });
      return {
        ok: true,
        body: {
          uploadId: input.uploadId,
          source: spec.id,
          rows: result.rows,
          upserted: result.upserted,
          skipped: result.skipped,
          grossTotal: result.grossTotal,
          feeTotal: result.feeTotal,
          taxTotal: result.taxTotal,
          netTotal: result.netTotal,
          windowFrom: result.from?.toISOString() ?? null,
          windowTo: result.to?.toISOString() ?? null,
          viewRefreshMs,
        },
      };
    })();

    this.inFlight = run;
    try {
      return await run;
    } finally {
      this.inFlight = null;
      await deleteStagedFile(path);
    }
  }

  /**
   * Read one Export into the fee mirror, assert the totals on what was written,
   * record provenance, and rebuild the view if asked. Throws only when the ingest
   * itself does; the check and the provenance never do.
   */
  async ingestFile(input: FeeIngestInput): Promise<FeeIngestOutcome> {
    const format: 'csv' | 'xlsx' = sniffBinary(await readStagedHead(input.path)) === 'xlsx' ? 'xlsx' : 'csv';
    const source = createExportSource(input.spec.id, input.path, format, input.filename);
    if (!source) throw new Error(`no reader for Export "${input.spec.id}"`);

    const result = await this.deps.ingest.execute(source);

    // Asserted on what was actually written rather than on what the preview
    // measured — the same bytes, but saying so is cheaper than assuming it.
    const check = checkFeeTotals(input.spec, {
      gross: result.grossTotal,
      fee: result.feeTotal,
      tax: result.taxTotal,
      net: result.netTotal,
      refunded: result.refundedTotal,
    });

    // Provenance in the same table the Pagos Upload and the inbox write to, so a
    // fee row can always be traced back to the Export that produced it.
    await this.deps.uploads
      .record({
        uploadedBy: input.actor,
        filename: input.filename,
        byteSize: input.byteSize,
        rowTotal: result.rows,
        rowsIngested: result.upserted,
        rowsSkipped: result.skipped,
        windowFrom: result.from,
        windowTo: result.to,
        error: check ? `${check.error}: ${check.message}` : null,
      })
      .catch((err) => console.error('fee upload provenance not recorded:', (err as Error).message));

    let viewRefreshMs: number | null = null;
    if (input.refreshView) {
      // Only the two views that read this table. Rebuilding all of them would
      // cost minutes and change nothing else. A failed refresh is reported, not
      // thrown: the rows are in, and the view catches up on the next cron.
      try {
        viewRefreshMs = 0;
        for (const view of GATEWAY_NET_VIEWS) {
          viewRefreshMs += (await this.deps.matViews.refresh(view, true)).durationMs;
        }
      } catch (err) {
        console.error('gateway net views not refreshed:', (err as Error).message);
      }
    }

    return { result, check, viewRefreshMs };
  }
}

function rejection(error: FeeUploadRejection['error'], message: string): FeeInspection {
  return { ok: false, rejection: { error, message } };
}

function refuse(status: number, error: FeeUploadRejection['error'], message: string): FeeConfirmOutcome {
  return { ok: false, status, rejection: { error, message } };
}

let instance: FeeUploadIntake | null = null;

/** The one intake per process; the ingest lock is a field on it. */
export function feeUploadIntake(): FeeUploadIntake {
  instance ??= new FeeUploadIntake({
    inspect: new InspectFeeExportUseCase(new DrizzleFeeUploadLookups()),
    ingest: new IngestPaymentExportUseCase(new DrizzleGatewayFeeRepository()),
    uploads: new DrizzlePaymentUploadRepository(),
    matViews: new DrizzleMaterializedViewRepository(),
  });
  return instance;
}
