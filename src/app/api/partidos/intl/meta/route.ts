import { getSessionUser } from '@/lib/auth/getSessionUser';
import { ok, serverError, unauthorized } from '@/lib/api/responses';
import { composePartidosIntlRepo } from '@/lib/api/composePartidosRepo';
import { GetPartidosIntlMetaUseCase } from '@partidos/core/use-cases/queries/GetPartidosIntlMetaUseCase';
import { withRequestLog } from 'basket-tv-telemetry/next';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withRequestLog('/api/partidos/intl/meta', async () => {
  if (!(await getSessionUser())) return unauthorized();
  try {
    const dto = await new GetPartidosIntlMetaUseCase(composePartidosIntlRepo()).execute();
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
});
