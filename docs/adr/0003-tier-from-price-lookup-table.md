---
status: accepted
---

# Tier falls back to an exact price book when the Platform price id is absent

Tier has always switched on the Platform's `price_id` (`100010` → Mensual Básico,
`100011`/`100030` → Mensual Total). The Pagos Export omits that column, so every
uploaded Pago would otherwise land in `Otros` and destroy the subscription-mix
breakdown. We seed a price book of **exact** current price points keyed by
`(currency, Period, amount)`, and the view prefers `price_id` when present, falling
back to the book when it is null. A Pago at a price the book does not contain
resolves to `Otros` and raises an `unmapped_price_points` warning on upload.

## Considered options

An amount **threshold** model was chosen first and is provably wrong. Because
510k existing Pagos carry a real `price_id`, the model could be scored against
ground truth rather than argued about: thresholds classified **61.3% of ARS and
2.4% of CLP** rows correctly. ARS inflation is the reason — today's Mensual Básico
price of 16 999 sits *above* the Mensual Total prices of previous years, and the
same amount appears under both Tiers at different times. Amount cannot identify a
Tier across time, so no set of thresholds can work.

Within a single recent year it can. Restricted to 2026, every price point is
unanimous: ARS 16 999 is Básico in 50 985 rows with no exceptions, ARS 12 999 is
Total in 14 997. Uploads only ever carry recent Pagos, so an exact book of current
prices is both sufficient and checkable.

## Consequences

- The book was mined from labelled rows, not guessed: monthly successful Pagos
  since 2026, grouped by currency and amount, keeping points with at least 99%
  Tier purity and 30 observations. On that population it covers **98.76%** of rows
  and classifies **101 371 of 101 373** matched rows the same way `price_id` does.
- Every currency is covered — ARS, CLP, UYU, USD, BRL, EUR, BOB, PEN — which the
  earlier threshold approach could not manage for the currencies whose prices form
  a continuum.
- The book goes stale when pricing changes: new price points classify as `Otros`
  until added. That failure is visible rather than silent, because uploads warn on
  unmatched points. Re-running the mining query once enough labelled rows exist
  regenerates it.
- API-sourced rows keep classifying exactly as before; only uploaded rows consult
  the book. The two coexist indefinitely, which matters because the upsert
  deliberately never overwrites `price_id`.
- We do not invent `price_id` values for uploaded rows: that column stays a record
  of what the Platform actually said, so derived and real data remain
  distinguishable.
