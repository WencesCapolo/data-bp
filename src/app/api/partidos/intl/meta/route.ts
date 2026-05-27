import { requireDashboard } from '@/lib/auth/rbac';
import { ok, serverError } from '@/lib/api/responses';
import { composePartidosIntlRepo } from '@/lib/api/composePartidosRepo';
import { GetPartidosIntlMetaUseCase } from '@partidos/core/use-cases/queries/GetPartidosIntlMetaUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  await requireDashboard('partidos');
  try {
    const dto = await new GetPartidosIntlMetaUseCase(composePartidosIntlRepo()).execute();
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
