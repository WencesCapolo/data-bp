import type { NextRequest } from 'next/server';
import { composeRepo } from '@/lib/api/composeRepo';
import { okCached, serverError } from '@/lib/api/responses';
import { GetMetaUseCase } from '@basket/core/use-cases/queries/GetMetaUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const dto = await new GetMetaUseCase(composeRepo()).execute();
    return okCached(req, dto, { maxAge: 60, staleWhileRevalidate: 120 });
  } catch (err) {
    return serverError(err);
  }
}
