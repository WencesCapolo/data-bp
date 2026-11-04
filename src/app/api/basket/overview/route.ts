import { getSessionUser } from '@/lib/auth/getSessionUser';
import type { NextRequest } from 'next/server';
import { composeRepo } from '@/lib/api/composeRepo';
import { badRequest, ok, serverError, unauthorized } from '@/lib/api/responses';
import { OverviewQuerySchema, parseSearchParams } from '@/lib/api/zodSchemas';
import { GetOverviewUseCase } from '@basket/core/use-cases/queries/GetOverviewUseCase';
import { withRequestLog } from 'basket-tv-telemetry/next';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withRequestLog('/api/basket/overview', async (req: NextRequest) => {
  if (!(await getSessionUser())) return unauthorized();
  const parsed = OverviewQuerySchema.safeParse(parseSearchParams(req));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const asOf = parsed.data.asOf ? new Date(parsed.data.asOf) : undefined;
    const dto = await new GetOverviewUseCase(composeRepo()).execute(asOf, parsed.data.range, parsed.data.filters);
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
});
