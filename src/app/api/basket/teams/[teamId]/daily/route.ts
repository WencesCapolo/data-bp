import type { NextRequest } from 'next/server';
import { composeRepo } from '@/lib/api/composeRepo';
import { badRequest, ok, serverError } from '@/lib/api/responses';
import { TeamDailyQuerySchema, TeamIdSchema, parseSearchParams } from '@/lib/api/zodSchemas';
import { GetTeamsUseCase } from '@basket/core/use-cases/queries/GetTeamsUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const id = TeamIdSchema.safeParse(teamId);
  if (!id.success) return badRequest(id.error);
  const parsed = TeamDailyQuerySchema.safeParse(parseSearchParams(req));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const dto = await new GetTeamsUseCase(composeRepo()).daily(
      id.data,
      parsed.data.range,
      parsed.data.filters,
    );
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
