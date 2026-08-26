import type { NextRequest } from 'next/server';
import { composeRepo } from '@/lib/api/composeRepo';
import { badRequest, ok, serverError } from '@/lib/api/responses';
import { ContenidoQuerySchema, parseSearchParams } from '@/lib/api/zodSchemas';
import { GetContenidoUseCase } from '@basket/core/use-cases/queries/GetContenidoUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const parsed = ContenidoQuerySchema.safeParse(parseSearchParams(req));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const dto = await new GetContenidoUseCase(composeRepo()).execute(parsed.data);
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
