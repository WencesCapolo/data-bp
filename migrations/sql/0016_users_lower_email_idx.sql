-- Phase 16: functional index on LOWER(basket_users.email).
--
-- Idempotent: an invalid leftover is dropped, then CREATE INDEX ... IF NOT
-- EXISTS. Safe to re-run.
--
--   pnpm sql:apply migrations/sql/0016_users_lower_email_idx.sql
--
-- CONCURRENTLY, deliberately: basket_users is 262k rows in dev and the sync
-- writes to it, so a plain CREATE INDEX holds a write lock for the length of the
-- build and blocks the cron. CONCURRENTLY cannot run inside a transaction, which
-- is why this file goes through scripts/apply-sql.ts (one statement per send)
-- and not through a whole-file execute. There is no psql on the prod box.
--
-- A CONCURRENTLY build that fails leaves the index behind marked invalid, and
-- IF NOT EXISTS would then happily skip it forever — an index that exists, is
-- never used, and is still maintained on every write. The DO block ahead clears
-- that case so a re-run actually repairs it.
--
-- The gateway customer mirror's only job is customer_id -> email -> Subscriber,
-- and the Provider stores whatever the Subscriber typed, so every lookup on that
-- bridge is case-folded. Without this index each one is a sequential scan of
-- basket_users, which took the coverage report past two minutes for 38k
-- customers and would take any per-Subscriber question with it.
--
-- Not UNIQUE, deliberately: emails are NOT unique in basket_users, which is the
-- same fact that makes a LEFT JOIN on this bridge inflate its own row count.
-- Ask the bridge with EXISTS, and index it so EXISTS is cheap.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = 'basket_users_lower_email_idx'
      AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid basket_users_lower_email_idx from a failed build';
    EXECUTE 'DROP INDEX basket_users_lower_email_idx';
  END IF;
END
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS basket_users_lower_email_idx
  ON basket_users(LOWER(email));
