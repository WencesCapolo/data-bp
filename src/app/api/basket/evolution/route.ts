import { getSessionUser } from '@/lib/auth/getSessionUser';
import type { NextRequest } from 'next/server';
import { composeRepo } from '@/lib/api/composeRepo';
import { badRequest, ok, serverError, unauthorized } from '@/lib/api/responses';
import { EvolutionQuerySchema, parseSearchParams } from '@/lib/api/zodSchemas';
import { GetEvolutionUseCase } from '@basket/core/use-cases/queries/GetEvolutionUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await getSessionUser())) return unauthorized();
  const parsed = EvolutionQuerySchema.safeParse(parseSearchParams(req));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const dto = await new GetEvolutionUseCase(composeRepo()).execute(
      parsed.data.range,
      parsed.data.granularity,
      parsed.data.filters,
    );
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
