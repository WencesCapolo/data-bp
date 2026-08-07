import type { NextRequest } from 'next/server';
import { composeRepo } from '@/lib/api/composeRepo';
import { badRequest, ok, serverError } from '@/lib/api/responses';
import { LifecycleQuerySchema, parseSearchParams } from '@/lib/api/zodSchemas';
import { GetLifecycleUseCase } from '@basket/core/use-cases/queries/GetLifecycleUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Split out of /overview on purpose: that route is all mat-view reads, this one
// runs a live window pass over every payment (~2s). Sharing a route would gate
// the whole tab on the slowest block.
export async function GET(req: NextRequest) {
  const parsed = LifecycleQuerySchema.safeParse(parseSearchParams(req));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const dto = await new GetLifecycleUseCase(composeRepo()).execute(
      parsed.data.range,
      parsed.data.filters,
    );
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
