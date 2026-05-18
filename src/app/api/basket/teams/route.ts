import type { NextRequest } from 'next/server';
import { composeRepo } from '@/lib/api/composeRepo';
import { badRequest, ok, serverError } from '@/lib/api/responses';
import { TeamsQuerySchema, parseSearchParams } from '@/lib/api/zodSchemas';
import { GetTeamsUseCase } from '@basket/core/use-cases/queries/GetTeamsUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const parsed = TeamsQuerySchema.safeParse(parseSearchParams(req));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const dto = await new GetTeamsUseCase(composeRepo()).execute(parsed.data.range, {
      limit: parsed.data.limit,
      country: parsed.data.country,
      filters: parsed.data.filters,
    });
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
