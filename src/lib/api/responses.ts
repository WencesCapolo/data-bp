import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

const NO_STORE = { 'cache-control': 'no-store' };

export function ok<T>(data: T, extraHeaders: Record<string, string> = {}): NextResponse {
  return NextResponse.json(data, { headers: { ...NO_STORE, ...extraHeaders } });
}

export function badRequest(err: ZodError): NextResponse {
  return NextResponse.json(
    { error: 'invalid_query', issues: err.issues },
    { status: 400, headers: NO_STORE },
  );
}

export function notFound(message = 'not_found'): NextResponse {
  return NextResponse.json({ error: message }, { status: 404, headers: NO_STORE });
}

export function serverError(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error('[api] server error:', err);
  return NextResponse.json(
    { error: 'internal_error', message, stack: process.env.NODE_ENV !== 'production' ? stack : undefined },
    { status: 500, headers: NO_STORE },
  );
}
