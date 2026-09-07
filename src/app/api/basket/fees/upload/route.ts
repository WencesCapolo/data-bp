// Preview step of a fee Export Upload — the Provider's own report of what it
// charged us, not our Control Panel's Pagos Export. The intake module reads the
// staged file end to end and reports what confirming would write.

import { NextResponse, type NextRequest } from 'next/server';
import { feeUploadIntake } from '@basket/infrastructure/upload/FeeUploadIntake';
import { authorizeUpload, receiveUpload, unauthorized } from '@/lib/api/uploadRequest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await authorizeUpload(req))) return unauthorized();

  const received = await receiveUpload(req);
  if (received instanceof NextResponse) return received;

  const sourceId = String(received.form.get('source') ?? '');
  const inspection = await feeUploadIntake().inspect(
    received.staged,
    received.file.name || 'export',
    sourceId,
  );
  return inspection.ok
    ? NextResponse.json(inspection.preview)
    : NextResponse.json(inspection.rejection, { status: 400 });
}
