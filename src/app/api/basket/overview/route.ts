import type { NextRequest } from 'next/server';
import { composeRepo } from '@/lib/api/composeRepo';
import { badRequest, ok, serverError } from '@/lib/api/responses';
import { OverviewQuerySchema } from '@/lib/api/zodSchemas';
import { GetOverviewUseCase } from '@basket/core/use-cases/queries/GetOverviewUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const parsed = OverviewQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const asOf = parsed.data.asOf ? new Date(parsed.data.asOf) : undefined;
    const dto = await new GetOverviewUseCase(composeRepo()).execute(asOf);
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
