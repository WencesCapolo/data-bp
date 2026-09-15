import { getSessionUser } from '@/lib/auth/getSessionUser';
import type { NextRequest } from 'next/server';
import { composeRepo } from '@/lib/api/composeRepo';
import { badRequest, ok, serverError, unauthorized } from '@/lib/api/responses';
import { RetentionQuerySchema, parseSearchParams } from '@/lib/api/zodSchemas';
import { GetRetentionUseCase } from '@basket/core/use-cases/queries/GetRetentionUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await getSessionUser())) return unauthorized();
  const parsed = RetentionQuerySchema.safeParse(parseSearchParams(req));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const dto = await new GetRetentionUseCase(composeRepo()).execute(
      parsed.data.range,
      parsed.data.filters,
      parsed.data.granularity,
    );
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
