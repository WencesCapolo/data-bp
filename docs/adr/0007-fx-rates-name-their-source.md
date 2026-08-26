---
status: accepted
---

# An FX rate is stored with the source that produced it

`/financiero` had no single revenue number anywhere. Three Providers, three
settlement currencies, seven presentment currencies, and nothing that could
convert one into another — so every figure on the tab was denominated in a
Provider's own money and the prototype's whole family of `*_usd` keys had no
live source at all.

We store daily rates in **`basket_fx_rates`, keyed `(day, base_currency,
quote_currency, source)`**, and convert **per day, in one place**
(`core/services/usdConversion.ts`).

`source` is in the primary key, not in a comment beside it. Two rates for the
same day are both correct and they disagree:

- **Stripe already converted.** Its balance transaction carries the
  `exchange_rate` it applied on the day it captured the charge, mirrored on
  `basket_payment_fees.exchange_rate`. That is the rate the money actually moved
  at, and a Stripe figure has to reconcile against it to the cent — no other
  rate can make that claim.
- **MercadoPago converted nothing.** It settles ARS into ARS and reports no rate
  at all, so an ARS figure converts at a rate we choose. The product owner chose
  the informal (**blue**) market, series **dolarapi**: `dolarapi.com` for the
  spot and `api.argentinadatos.com` for the daily history — 5,712 days back to
  2011-01-03, every calendar day present.

A table that could not say which of the two produced a number could not answer
the question the tab asks. So it says.

## Considered options

**One rate per day, no source column.** Cheaper, and wrong the first time a
Stripe figure and an ARS figure are compared: one would silently be converted at
the blue rate Stripe never used, and the cent-level reconciliation against
Stripe's own ledger becomes impossible to even express.

**Converting at the current spot rate.** Rejected outright. A 2024 Argentine
Pago converted at today's blue rate is not a rounding error — the blue rate went
from roughly 1,000 to 1,565 ARS/USD over the period the Pagos cover. This is why
the *history* endpoint is the source and the spot endpoint is only how today gets
a rate before the history catches up.

**Converting monthly totals at a month rate.** Rejected for the same reason at
smaller scale: over July 2024 alone the blue moved 1,370 → 1,500 (9.5%), and
revenue is not spread evenly across a month. The conversion is applied to the
**day** grain, which both the filtered and unfiltered query paths already
produce, and the monthly and range figures are sums of already-converted days.

**Fetching a rate per Provider currency from one commercial feed.** No feed we
would trust quotes the informal ARS market, which is the one figure that actually
matters here; and mixing an official EUR/USD rate with an informal ARS/USD one
under a single unnamed `source` is precisely the ambiguity this key forbids.

**`compra` or `venta`.** The blue history quotes both, ~1.3–1.6% apart. Revenue
arriving is a sale of dollars, so **`venta`** is `rate` and `compra` is carried
in `buy_rate` for audit and never converted with. The choice is stated in the
column comment as well as here, so it cannot be lost with this file.

## Consequences

- **`rate` is quote units per one base unit, and the pair is read off the key.**
  `(USD, ARS, 'blue', 1565)` is 1,565 ARS per USD, so an ARS amount is *divided*.
  `(UYU, USD, 'stripe', 0.0256)` is USD per UYU, so a UYU amount is *multiplied*.
  Nothing infers a direction from the magnitude.
- **The `'stripe'` rows are derived, not fetched.** They are
  `SUM(settlement_amount) / SUM(gross_amount)` per day and presentment currency,
  volume-weighted, rebuilt by `refreshDerivedStripeRates()` on every sync. They
  exist so a converted Stripe figure can *name* a rate — a per-transaction rate
  cannot be printed next to a monthly total. Conversion of Stripe rows still
  happens at the row's own rate, which is what reconciles.
- **A currency nobody quotes is absent, not zero.** EUR has no source today —
  dolarapi quotes ARS, and Stripe leaves EUR settled in EUR — so every EUR USD
  figure is `null` and the tab prints `—`. Zero would claim we converted it and
  got nothing. If EUR ever needs a figure, it needs a *decision about a source*,
  which is a question for the owner and not a default.
- **A total is null unless every day inside it had a rate.** `daysMissingRate`
  says why. The blue history carries every calendar day, weekends at the previous
  close, so a gap means the feed broke rather than that the market was shut —
  which is why `gaps()` returns the days and `pnpm smoke:fx` asserts zero of them.
- **Stripe's `exchange_rate` is minor units per minor unit.** Multiplying our
  major-unit `gross_amount` by it overstated CLP a hundredfold — CLP is
  zero-decimal, so 1,000 CLP is 1,000 minor units — while every two-decimal
  currency passed, which is how the error survived a check on the total. Any
  reader of that column goes through `majorUnitRate()` in
  `infrastructure/gateways/money.ts`. The derived rows do not need it: they are
  built from two major-unit sums.
- **The sync rides the analytics cron** (ADR 0006), as step 8c, *after* the fee
  sync — the derived rows are read out of the fee mirror, so running first would
  name a rate from before this run's charges landed. It needs no credential, so
  it is not gated on `SYNC_GATEWAYS_ENABLED`; `SYNC_FX_ENABLED=false` switches it
  off on its own. Never fatal, like every step around it.
- **The first load is `pnpm backfill:fx`** and it is safe to re-run: every row is
  an upsert on the four-column key. `pnpm smoke:fx` is the verification — the
  history is whole, Stripe reconciles to the cent, and the DTO's USD figures each
  name the rate that produced them.
