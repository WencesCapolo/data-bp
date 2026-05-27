import type { NextRequest } from 'next/server';
import { requireDashboard } from '@/lib/auth/rbac';
import { badRequest, ok, serverError } from '@/lib/api/responses';
import { parseSearchParams } from '@/lib/api/zodSchemas';
import { NacionalFiltersSchema } from '@/lib/api/partidosSchemas';
import { composePartidosNacionalRepo } from '@/lib/api/composePartidosRepo';
import { GetPartidosNacionalOverviewUseCase } from '@partidos/core/use-cases/queries/GetPartidosNacionalOverviewUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  await requireDashboard('partidos');
  const parsed = NacionalFiltersSchema.safeParse(parseSearchParams(req));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const dto = await new GetPartidosNacionalOverviewUseCase(composePartidosNacionalRepo())
      .execute(parsed.data);
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
