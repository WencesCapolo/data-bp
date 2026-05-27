import { NextResponse } from "next/server";

export function errorResponse(
  err: unknown,
  fallback: string,
  status = 500,
): NextResponse {
  console.error(`[${fallback}]`, err);
  const message =
    process.env.NODE_ENV === "production"
      ? fallback
      : err instanceof Error
        ? err.message
        : fallback;
  return NextResponse.json({ error: message }, { status });
}
