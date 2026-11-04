/** Postgres `undefined_table`: a table that predates its migration. */
const UNDEFINED_TABLE = '42P01';

/**
 * Whether a query failed because its table does not exist yet. Drizzle wraps
 * the driver's error in a `DrizzleQueryError`, so the code may be on `cause`.
 */
export function isMissingTable(err: unknown): boolean {
  const code = (e: unknown) => (typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined);
  return code(err) === UNDEFINED_TABLE || (typeof err === 'object' && err !== null && code((err as { cause?: unknown }).cause) === UNDEFINED_TABLE);
}
