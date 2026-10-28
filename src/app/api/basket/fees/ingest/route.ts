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
import { feeUploadIntake } from '@basket/infrastructure/upload/FeeUploadIntake';
import { actorName, authorizeUpload, unauthorized } from '@/lib/api/uploadRequest';
import { trackServerEvent } from '@/lib/telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  uploadId: z.string().uuid(),
  source: z.string().min(1).max(64),
  /** Echoed from the preview, used only when the server's own memory of the
   *  staged file was lost to a restart. */
  filename: z.string().min(1).max(400).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await authorizeUpload(req);
  if (!actor) return unauthorized();

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'unknown_source', message: 'Falta el identificador de la carga o del Export.' },
      { status: 400 },
    );
  }

  const outcome = await feeUploadIntake().confirm({
    uploadId: parsed.data.uploadId,
    sourceId: parsed.data.source,
    actor: actorName(actor),
    fallbackFilename: parsed.data.filename,
  });
  if (!outcome.ok) return NextResponse.json(outcome.rejection, { status: outcome.status });
  trackServerEvent('fees_ingested', actor.kind === 'analyst' ? actor.user.id : null, { source_id: parsed.data.source });
  return NextResponse.json(outcome.body);
}
