import { getSessionUser } from '@/lib/auth/getSessionUser';
import type { NextRequest } from 'next/server';
import { composeRepo } from '@/lib/api/composeRepo';
import { okCached, serverError, unauthorized } from '@/lib/api/responses';
import { GetMetaUseCase } from '@basket/core/use-cases/queries/GetMetaUseCase';
import { withRequestLog } from 'basket-tv-telemetry/next';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withRequestLog('/api/basket/meta', async (req: NextRequest) => {
  if (!(await getSessionUser())) return unauthorized();
  try {
    const dto = await new GetMetaUseCase(composeRepo()).execute();
    return okCached(req, dto, { maxAge: 60, staleWhileRevalidate: 120 });
  } catch (err) {
    return serverError(err);
  }
});
