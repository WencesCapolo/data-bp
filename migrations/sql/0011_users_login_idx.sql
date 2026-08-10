-- The lifecycle funnel counts active_no_sub / never_subscribed by filtering
-- basket_users on status = 1 AND login_at > NOW() - INTERVAL '30 days'
-- (optionally by country). Without this index that is a full table scan on
-- every request.
CREATE INDEX IF NOT EXISTS basket_users_login_at_idx
  ON basket_users (login_at)
  WHERE status = 1;
