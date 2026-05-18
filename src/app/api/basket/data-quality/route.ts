import { composeRepo } from '@/lib/api/composeRepo';
import { ok, serverError } from '@/lib/api/responses';
import { GetDataQualityUseCase } from '@basket/core/use-cases/queries/GetDataQualityUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const dto = await new GetDataQualityUseCase(composeRepo()).execute();
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
