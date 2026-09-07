// Preview step of a Pagos Upload. Stages the file and hands it to the intake
// module, which says what confirming would do without writing a row. Both admin
// and viewer may Upload (docs/adr/0004); provenance, not permission, is the
// safeguard, and the row that records it is written by the confirm step.

import { NextResponse, type NextRequest } from 'next/server';
import { pagosUploadIntake } from '@basket/infrastructure/upload/PagosUploadIntake';
import { authorizeUpload, receiveUpload, unauthorized } from '@/lib/api/uploadRequest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await authorizeUpload(req))) return unauthorized();

  const received = await receiveUpload(req);
  if (received instanceof NextResponse) return received;

  const inspection = await pagosUploadIntake().inspect(received.staged, received.file.name || 'export.csv');
  return inspection.ok
    ? NextResponse.json(inspection.preview)
    : NextResponse.json(inspection.rejection, { status: 400 });
}
