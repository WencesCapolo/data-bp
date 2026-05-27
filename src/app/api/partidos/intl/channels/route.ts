import type { NextRequest } from 'next/server';
import { requireDashboard } from '@/lib/auth/rbac';
import { badRequest, ok, serverError } from '@/lib/api/responses';
import { parseSearchParams } from '@/lib/api/zodSchemas';
import { IntlFiltersSchema } from '@/lib/api/partidosSchemas';
import { composePartidosIntlRepo } from '@/lib/api/composePartidosRepo';
import { GetPartidosIntlChannelsUseCase } from '@partidos/core/use-cases/queries/GetPartidosIntlChannelsUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  await requireDashboard('partidos');
  const parsed = IntlFiltersSchema.safeParse(parseSearchParams(req));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const dto = await new GetPartidosIntlChannelsUseCase(composePartidosIntlRepo())
      .execute(parsed.data);
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
