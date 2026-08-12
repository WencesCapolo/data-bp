---
status: accepted
---

# Gateway data syncs with the analytics cron, and amount corrections are a sync step

Stripe and MercadoPago data was reachable only through one-off backfill scripts.
That is fine for the first load and wrong as a steady state: fees, subscription
statuses and the Pagos mirror would drift apart between manual runs, and nobody
would notice until a number looked wrong. Gateway reads now run inside
`RunSyncUseCase`, on the same schedule as everything else.

Three steps were added, in this order, between the Pagos sync and the mat view
refresh. The order is not incidental — each depends on the one before.

## 7. Fees — delta

`SyncGatewayFeesUseCase` resumes from its own `fees:<slug>` watermark minus an
overlap, so a 6-hourly run reads hours of ledger rather than years. The overlap
exists because a fee row is not immutable: a refund or dispute lands days after
the charge and changes the row it belongs to. Fourteen days covers Stripe's
refund window and MercadoPago's mediation window.

Only a clean run advances the watermark. A gateway with no watermark at all
returns an error rather than defaulting to "the last two weeks", which would look
like success while leaving years unread — the first load must be an explicit
backfill.

## 8. Subscriptions — full refresh, deliberately not a delta

This is the one place the "bring only the delta" instruction cannot be honoured,
and the reason is in the data rather than in the implementation. A subscription's
decisive field is whether it is still alive, and cancellation is an *update* to an
object that may have been created two years ago. Stripe's list endpoint filters
on `created` and offers no `updated` filter, so any window would systematically
miss precisely the events churn reporting exists to count. The Events API reports
changes but retains only 30 days, making it a supplement rather than a source of
truth.

So the whole set is re-read and upserted each run: ~52k subscriptions, ~520
requests, ~12 minutes. That is affordable at this size and always correct. If the
subscription count grows by an order of magnitude, the answer is a nightly full
pass plus an Events-API delta on the cron — not a `created` window, which would
be quietly wrong at any size.

`status=all` is mandatory on that endpoint. Its default returns live
subscriptions only, which would hide every cancelled one.

## 9. Amount reconciliation

The Control Panel export encodes some CLP amounts with two decimal places, and
CLP has none. 957 Pagos were affected across a five-week window in late 2024,
some stored 100x too high and some 100x too low, overstating CLP revenue by ~409M
CLP in aggregate.

Correcting them once does not hold: the defect is in the export, and every ingest
rewrites `amount` from it. So the correction is a **sync step**, not a migration —
`ReconcilePaymentAmountsUseCase` realigns `basket_payments.amount` to
`basket_payment_fees.gross_amount` after every run. It must come after the fee
sync, which supplies the truth, and before the mat view refresh, because `amount`
is a join key into `basket_price_tiers` and a corrected amount can change a Pago's
`sub_type`.

Scope is narrow on purpose: only an exact 100x or 0.01x ratio in a matching
currency is touched. Any other disagreement with the gateway is a different bug
with a different cause; those are counted and reported, never rewritten to a
number nobody has verified. The currency gate matters — `basket_payment_fees` also
holds a settlement amount, and comparing a presentment amount against a settled
one would "correct" every converted charge into nonsense.

This is a workaround for an upstream defect and should be retired, not kept. The
real fix belongs in whatever generates the export's CLP column.

## Consequences

- **No gateway step is ever fatal.** A Stripe outage must not cost the Pagos sync
  that already succeeded, so each step records its failure in `RunSyncResult` and
  the run continues. A gateway missing its credential is skipped and logged, so a
  deploy without `MP_ACCESS_TOKEN` still syncs everything else.
- **Charges link to subscriptions through the invoice.** A charge carries only an
  invoice id; the subscription lives one hop further out. Expanding
  `data.source.invoice` inline is not possible — `source` is polymorphic and
  Stripe errors on an expansion path that does not apply to every member — so the
  window's invoices are listed in a second pass and joined in memory. This roughly
  doubles Stripe requests per fee window, which is immaterial for a delta.
- **A charge whose invoice predates the window resolves to null**, and the upsert
  therefore `COALESCE`s `subscription_id` rather than overwriting it. Letting a
  null from a boundary miss replace a link already stored would erase good data on
  every overlap pass. The trailing overlap recovers these.
- **MercadoPago has no subscription link.** Its payments do not carry the
  preapproval id, so tying an MP charge to its subscription needs the preapproval
  search — a separate fetcher, not yet built. The column is honestly null rather
  than guessed from timing or amount.
- **`incomplete_expired` is not churn.** 8,811 of 51,830 subscriptions never
  completed a first payment. They are failed signups, not departed customers, and
  including them would inflate cancellations by roughly a quarter.
