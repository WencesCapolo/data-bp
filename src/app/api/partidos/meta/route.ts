import { getSessionUser } from '@/lib/auth/getSessionUser';
import { ok, serverError, unauthorized } from '@/lib/api/responses';
import { composePartidosNacionalRepo } from '@/lib/api/composePartidosRepo';
import { GetPartidosNacionalMetaUseCase } from '@partidos/core/use-cases/queries/GetPartidosNacionalMetaUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!(await getSessionUser())) return unauthorized();
  try {
    const dto = await new GetPartidosNacionalMetaUseCase(composePartidosNacionalRepo()).execute();
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
