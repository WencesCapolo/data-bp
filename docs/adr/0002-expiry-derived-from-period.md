---
status: accepted
---

# Subscription expiry is derived from Period, not read from the Export

The Pagos Export has no expiry column, but `basket_payments.expires_at` is `NOT NULL`
and every active-subscriber and churn metric reads it. We derive it as
`created_at + Period days` (30, 365, or 0) rather than making the column nullable or
waiting for the Platform to add the field.

## Consequences

- A Subscription cancelled mid-period, or given a grace extension, keeps its derived
  expiry and therefore reads as active slightly longer than reality. Active counts skew
  marginally high, never low.
- Rows that came from the old API path retain their true expiry: the upsert updates
  `expires_at`, so a re-Upload of an old Window will overwrite real expiries with derived
  ones. Accepted because the API path is dead and will not produce new rows.
- If the Export ever gains an expiry column, prefer it and stop deriving; the derivation
  is a fallback, not the model.
