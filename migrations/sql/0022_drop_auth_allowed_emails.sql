-- Analytics is a Session reader (ADR 0008): who may enter is the `analytics`
-- Acceso in the portal's Auth DB, not a private allowlist here.
--
-- Run ONLY after the portal's `pnpm db:auth:seed-siblings` has copied these rows
-- into auth_app_access (it reads this table through SEED_ANALYTICS_DATABASE_URL).
-- Not part of the automatic deploy; the cutover checklist (basket#175) runs it.
drop table if exists auth_allowed_emails;
