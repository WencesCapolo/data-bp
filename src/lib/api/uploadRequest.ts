// What every Upload endpoint does before it can look at the file: decide who is
// asking, and get the body onto disk. One copy, so the bypass rule and the size
// ceiling cannot drift between the Pagos and the fee endpoints.

import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, type SessionUser } from '@/lib/auth/getSessionUser';
import {
  MAX_UPLOAD_BYTES,
  UploadTooLargeError,
  stageUpload,
  sweepStagedFiles,
  type StagedFile,
} from '@shared/lib/uploadStaging';

/**
 * Mirrors the bypass in src/proxy.ts: honoured only outside production and only
 * when INTERNAL_API_TOKEN is set. Used by the smoke scripts, and deliberately
 * NOT a second production credential.
 */
export function internalBypass(req: NextRequest): boolean {
  const token = process.env.INTERNAL_API_TOKEN;
  return (
    process.env.NODE_ENV !== 'production' &&
    !!token &&
    req.headers.get('x-internal-token') === token
  );
}

export type UploadActor =
  | { kind: 'analyst'; user: SessionUser }
  | { kind: 'automation'; name: string };

/**
 * Authentication only: ADR 0004 deliberately lets viewers Upload too. Must NOT
 * use requireSession() — that redirects, which turns an unauthorised API call
 * into a 303 to /login and then a 404 HTML page. API routes answer 401 JSON.
 */
export async function authorizeUpload(
  req: NextRequest,
  automationName = 'automation:internal-token',
): Promise<UploadActor | null> {
  const user = await getSessionUser();
  if (user) return { kind: 'analyst', user };
  if (internalBypass(req)) return { kind: 'automation', name: automationName };
  return null;
}

export function actorName(actor: UploadActor): string {
  return actor.kind === 'analyst' ? actor.user.email : actor.name;
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export interface ReceivedUpload {
  form: FormData;
  file: File;
  staged: StagedFile;
}

/**
 * The multipart body's `file`, staged to disk with the size ceiling enforced as
 * the bytes arrive. Returns the response to send when there is nothing to stage.
 */
export async function receiveUpload(req: NextRequest): Promise<ReceivedUpload | NextResponse> {
  void sweepStagedFiles().catch(() => {});

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) {
    return NextResponse.json(
      { error: 'no_file', message: 'No se recibió ningún archivo en el campo "file".' },
      { status: 400 },
    );
  }

  try {
    const staged = await stageUpload(file.stream() as ReadableStream<Uint8Array>);
    return { form, file, staged };
  } catch (err) {
    if (err instanceof UploadTooLargeError) {
      const mb = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));
      return NextResponse.json(
        {
          error: 'too_large',
          message: `El archivo supera el máximo de ${mb} MB. Descargá el Export de un período más corto.`,
        },
        { status: 400 },
      );
    }
    throw err;
  }
}
