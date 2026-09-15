import { getSessionUser } from '@/lib/auth/getSessionUser';
import type { NextRequest } from 'next/server';
import { composeRepo } from '@/lib/api/composeRepo';
import { badRequest, ok, serverError, unauthorized } from '@/lib/api/responses';
import { EconomiaQuerySchema, parseSearchParams } from '@/lib/api/zodSchemas';
import { GetEconomiaUseCase } from '@basket/core/use-cases/queries/GetEconomiaUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await getSessionUser())) return unauthorized();
  const parsed = EconomiaQuerySchema.safeParse(parseSearchParams(req));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const dto = await new GetEconomiaUseCase(composeRepo()).execute(
      parsed.data.range,
      parsed.data.filters,
    );
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
