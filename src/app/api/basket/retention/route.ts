import { composeRepo } from '@/lib/api/composeRepo';
import { ok, serverError } from '@/lib/api/responses';
import { GetRetentionUseCase } from '@basket/core/use-cases/queries/GetRetentionUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const dto = await new GetRetentionUseCase(composeRepo()).execute();
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
