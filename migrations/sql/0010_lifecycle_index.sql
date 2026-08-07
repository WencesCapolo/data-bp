-- The lifecycle endpoint runs a window pass partitioned by user_id and ordered
-- by created_at over every successful Pago. Without this index that is an
-- external merge sort of ~435k rows on every request.
CREATE INDEX IF NOT EXISTS basket_payments_user_created_idx
  ON basket_payments (user_id, created_at)
  INCLUDE (expires_at)
  WHERE status = 1;
