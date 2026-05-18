import type { NextRequest } from 'next/server';
import { composeRepo } from '@/lib/api/composeRepo';
import { badRequest, ok, serverError } from '@/lib/api/responses';
import { RangeQuerySchema } from '@/lib/api/zodSchemas';
import { GetFinanceUseCase } from '@basket/core/use-cases/queries/GetFinanceUseCase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const parsed = RangeQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const dto = await new GetFinanceUseCase(composeRepo()).execute(parsed.data);
    return ok(dto);
  } catch (err) {
    return serverError(err);
  }
}
