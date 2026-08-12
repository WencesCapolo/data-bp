---
status: accepted
---

# Gateway fees come from bulk ledger reads, keyed by the gateway's own id

Commission is the one number the Pagos mirror can never derive. `basket_payments`
records what the subscriber was charged; what MercadoPago and Stripe kept, and
what actually landed in the account, exist only on their side. Net revenue, the
fee-percentage chart and every USD line in the old dashboard depend on it, so the
fees have to be pulled.

We pull them by **listing each gateway's ledger over time windows**, not by
looking up each Pago by id, and store the result in `basket_payment_fees` keyed by
`(platform, platform_payment_id)`.

## Considered options

**Per-id lookup** is the obvious shape and is 428k requests — 273k MercadoPago
payments plus 155k Stripe PaymentIntents. Both gateways expose a list endpoint
returning 100 transactions per request with the fee data already inline, which
brings the same coverage down to roughly 2.8k + 1.6k requests. At Stripe's read
limit that is minutes instead of hours, and it is the same data.

**Storing fees on `basket_payments`** was rejected. The gateways answer with
transactions this mirror may not have — a Pago whose Subscriber is unknown is
skipped on upload and never gets a row — so fee data would have nowhere to land
and would be silently dropped. A separate table keyed the way the gateway keys it
also means the fee backfill and the payment ingestion never block each other, and
that the fee mirror can be rebuilt from scratch without touching Pagos.

**Reading Stripe fees from the PaymentIntent** does not work: fees are not on the
PaymentIntent. They are on the balance transaction the charge produced, which is
also the only record of the settlement amount and of the exchange rate Stripe
actually applied. The ledger is therefore the source, and `expand[]=data.source`
brings the charge — and with it the PaymentIntent id we join on — inline.

## Consequences

- **Two currency planes are stored, never mixed.** *Presentment* (`currency`,
  `gross_amount`) is what the subscriber paid and reconciles against
  `basket_payments.amount`. *Settlement* (`settlement_currency`, `fee_amount`,
  `net_amount`, `settlement_amount`) is what the gateway moved. Fees exist only in
  the settlement plane; a fee expressed in the presentment currency would be a
  derived number and is not stored. `exchange_rate` records the conversion the
  gateway applied, or is null when it applied none.
- **ARS → USD is still unsolved and deliberately out of scope here.** MercadoPago
  settles ARS into ARS and reports no rate, so its two planes collapse. Turning
  ARS into USD needs the blue-rate table, which is a different source with a
  different owner; inventing a rate inside a mirror of what the gateway said
  would make the mirror untrustworthy.
- **MercadoPago's 1000-result ceiling is absorbed by splitting windows.** The
  search endpoint refuses `offset + limit > 1000` and offers no cursor, so any
  window returning more than 1000 payments is halved recursively. At ~340
  payments/day this never triggers; if a single second ever exceeds 1000 the rows
  past 1000 are unreachable by any query MercadoPago offers, and the run says so
  rather than reporting success.
- **Refunds are a snapshot, not a stream.** `refunded_amount` is read off the
  transaction at fetch time, so a refund issued after its window was synced is
  only picked up when that window is re-read. Incremental runs therefore re-read
  the last 14 days rather than resuming exactly where they stopped — enough for
  Stripe's refund window and MercadoPago's mediation window.
- **Only a clean run advances the `fees:<slug>` watermark.** A partial run that
  recorded its end date would make the gap it left invisible to every later
  incremental sync, so the watermark moves only after a gateway finishes without
  error. Rows are upserted, so repeating a failed run is always safe.
- **Three payment sources can never have fees**, and this is a property of the
  data, not a gap to close: PayPal Pagos carry internal `upgrd_*` ids rather than
  PayPal transaction ids (2,475 rows, all amount 0), MercadoPago `hex32` ids are
  preapproval authorizations rather than payments (496 rows), and Stripe `sub_*`
  ids are subscriptions (467 rows). Coverage is measured against Pagos that carry
  a real gateway payment id, so these do not depress the number.
- **Zero-decimal currencies are handled explicitly.** Stripe quotes minor units,
  and CLP — 33k Pagos — has no minor unit. Dividing it by 100 would report
  Chilean revenue at 1% of its true value.
