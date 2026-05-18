import type { NextRequest } from 'next/server';
import { composeRepo } from '@/lib/api/composeRepo';
import { badRequest, ok, serverError } from '@/lib/api/responses';
import { TeamsQuerySchema } from '@/lib/api/zodSchemas';
import { GetTeamsUseCase } from '@basket/core/use-cases/queries/GetTeamsUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const parsed = TeamsQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const dto = await new GetTeamsUseCase(composeRepo()).execute(
      parsed.data.range,
      parsed.data.limit,
      parsed.data.country,
    );
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
