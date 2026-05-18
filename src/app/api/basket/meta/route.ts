import { composeRepo } from '@/lib/api/composeRepo';
import { ok, serverError } from '@/lib/api/responses';
import { GetMetaUseCase } from '@basket/core/use-cases/queries/GetMetaUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const dto = await new GetMetaUseCase(composeRepo()).execute();
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
