import { composeRepo } from '@/lib/api/composeRepo';
import { badRequest, ok, serverError } from '@/lib/api/responses';
import { TeamIdSchema } from '@/lib/api/zodSchemas';
import { GetTeamsUseCase } from '@basket/core/use-cases/queries/GetTeamsUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const parsed = TeamIdSchema.safeParse(teamId);
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const dto = await new GetTeamsUseCase(composeRepo()).trend(parsed.data);
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
