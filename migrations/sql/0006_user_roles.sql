-- User roles: admin (full access + can manage allowlist) vs viewer (default).
-- auth_user.role already exists as nullable TEXT (from 0005). Tighten it.

UPDATE auth_user SET role = 'viewer' WHERE role IS NULL OR role NOT IN ('admin','viewer');

ALTER TABLE auth_user
  ALTER COLUMN role SET DEFAULT 'viewer',
  ALTER COLUMN role SET NOT NULL;

ALTER TABLE auth_user
  DROP CONSTRAINT IF EXISTS auth_user_role_check;
ALTER TABLE auth_user
  ADD  CONSTRAINT auth_user_role_check CHECK (role IN ('admin','viewer'));

-- Pre-provision role for emails not yet signed in.
ALTER TABLE auth_allowed_emails
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'viewer';

ALTER TABLE auth_allowed_emails
  DROP CONSTRAINT IF EXISTS auth_allowed_emails_role_check;
ALTER TABLE auth_allowed_emails
  ADD  CONSTRAINT auth_allowed_emails_role_check CHECK (role IN ('admin','viewer'));
