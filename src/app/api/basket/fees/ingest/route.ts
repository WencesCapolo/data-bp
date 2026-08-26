// Confirm step of a fee Export Upload: reads the staged file into
// `basket_payment_fees` and rebuilds the one view that reads it.
//
// Deliberately NOT /api/sync. A Pagos Upload has to run a full Sync — its rows
// feed Subscribers, tiers, lifecycle, every mat view. A fee Export feeds one
// table and one view, and routing it through the Sync would rebuild the whole
// analytics pipeline (and take the Sync's in-flight lock) to record what a
// Provider charged us last month.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { IngestPaymentExportUseCase } from '@basket/core/use-cases/sync/IngestPaymentExportUseCase';
import { DrizzleGatewayFeeRepository } from '@basket/infrastructure/db/repositories/DrizzleGatewayFeeRepository';
import { DrizzlePaymentUploadRepository } from '@basket/infrastructure/db/repositories/DrizzlePaymentUploadRepository';
import { DrizzleMaterializedViewRepository } from '@basket/infrastructure/db/repositories/DrizzleMaterializedViewRepository';
import { createExportSource } from '@basket/infrastructure/exports/resolveExportSource';
import { checkFeeTotals } from '@basket/core/dtos/feeTotalsCheck';
import {
  feeExportSource,
  type FeeUploadRejection,
  type FeeUploadRejectionCode,
  type FeeUploadResultDTO,
} from '@basket/core/dtos/FeeUploadDTO';
import { getSessionUser } from '@/lib/auth/getSessionUser';
import {
  deleteStagedFile,
  readStagedHead,
  resolveStagedPath,
  sniffBinary,
  takeUploadMeta,
} from '@shared/lib/uploadStaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  uploadId: z.string().uuid(),
  source: z.string().min(1).max(64),
  /** Echoed from the preview, used only when the server's own memory of the
   *  staged file was lost to a restart. */
  filename: z.string().min(1).max(400).optional(),
});

function reject(error: FeeUploadRejectionCode, message: string, status = 400): NextResponse {
  const body: FeeUploadRejection = { error, message };
  return NextResponse.json(body, { status });
}

function internalBypass(req: NextRequest): boolean {
  const token = process.env.INTERNAL_API_TOKEN;
  return (
    process.env.NODE_ENV !== 'production' &&
    !!token &&
    req.headers.get('x-internal-token') === token
  );
}

/** One ingest at a time. Two Exports of the same month landing concurrently
 *  would each be correct and would race on the same keys for no gain. */
let inFlight: Promise<unknown> | null = null;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user && !internalBypass(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return reject('unknown_source', 'Falta el identificador de la carga o del Export.');
  }
  const spec = feeExportSource(parsed.data.source);
  if (!spec) return reject('unknown_source', `No conozco el Export "${parsed.data.source}".`);

  const path = resolveStagedPath(parsed.data.uploadId);
  if (!path) return reject('expired', 'El identificador de la carga no es válido.');

  if (inFlight) {
    return NextResponse.json(
      { error: 'already_running', message: 'Ya hay una carga de comisiones en curso.' },
      { status: 409 },
    );
  }

  const meta = takeUploadMeta(parsed.data.uploadId);
  const filename = meta?.filename ?? parsed.data.filename ?? 'export';

  const run = (async (): Promise<NextResponse> => {
    let head;
    try {
      head = await readStagedHead(path);
    } catch {
      return reject(
        'expired',
        'El archivo ya no está en el servidor. Las cargas sin confirmar se borran a la media hora: ' +
          'volvé a subirlo.',
      );
    }
    const format: 'csv' | 'xlsx' = sniffBinary(head) === 'xlsx' ? 'xlsx' : 'csv';

    const source = createExportSource(spec.id, path, format, filename);
    if (!source) return reject('unknown_source', `No tengo lector para el Export "${spec.id}".`);

    const fees = new DrizzleGatewayFeeRepository();
    const uploads = new DrizzlePaymentUploadRepository();
    const result = await new IngestPaymentExportUseCase(fees).execute(source);

    // Asserted again, on what was actually written rather than on what the
    // preview measured — the preview's file and this one are the same bytes, but
    // saying so is cheaper than assuming it. Same function the preview, the CLI
    // and the SFTP inbox call.
    const bad = checkFeeTotals(spec, {
      gross: result.grossTotal,
      fee: result.feeTotal,
      tax: result.taxTotal,
      net: result.netTotal,
      refunded: result.refundedTotal,
    });

    // Provenance in the same table the Pagos Upload and the CLI write to, so a
    // fee row can always be traced back to the Export that produced it.
    await uploads
      .record({
        uploadedBy: user?.email ?? 'automation:internal-token',
        filename,
        byteSize: meta?.byteSize ?? 0,
        rowTotal: result.rows,
        rowsIngested: result.upserted,
        rowsSkipped: result.skipped,
        windowFrom: result.from,
        windowTo: result.to,
        error: bad ? `${bad.error}: ${bad.message}` : null,
      })
      .catch((err) => console.error('fee upload provenance not recorded:', (err as Error).message));

    // Only the view that reads this table. Rebuilding all of them here would
    // cost minutes and change nothing else: no other view reads fees.
    let viewRefreshMs: number | null = null;
    try {
      const refreshed = await new DrizzleMaterializedViewRepository()
        .refresh('basket_mat_gateway_net_daily', true);
      viewRefreshMs = refreshed.durationMs;
    } catch (err) {
      console.error('gateway net view not refreshed:', (err as Error).message);
    }

    const body: FeeUploadResultDTO = {
      uploadId: parsed.data.uploadId,
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
    };
    return NextResponse.json(body);
  })();

  inFlight = run;
  try {
    return await run;
  } finally {
    inFlight = null;
    // The staged file has done its job either way: a failed ingest is re-run by
    // uploading again, never by re-confirming a handle whose file may be half
    // consumed.
    await deleteStagedFile(path);
  }
}
