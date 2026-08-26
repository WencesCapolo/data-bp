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

## 8b. Customers, disputes, payouts — the same two shapes again

The three later mirrors added nothing new to this decision, which is the point.
Each one is read in whichever of the two shapes above its data allows, and the
choice is a fact about the object rather than a preference:

| mirror | shape | why |
|---|---|---|
| clientes | full refresh | the email is edited long after creation, and the list endpoint filters on `created` only — the same trap as cancellation |
| disputadas | window + overlap | a dispute is opened once and closes within weeks |
| transferencias | window + overlap | a payout's status settles within days |

So there are exactly two use cases behind all five mirrors —
`SyncGatewayWindowMirrorUseCase` and `SyncGatewayFullMirrorUseCase`, generic over
the row type — instead of five near-identical ones. `SyncGatewayFeesUseCase` and
`SyncGatewaySubscriptionsUseCase` predate them and were left alone: they are
working code with their own tests and comments, and rewriting them to prove a
point would risk the one mirror everything else already reads.

The window mirrors take a **30-day** overlap rather than the fee sync's 14. A
dispute's evidence window alone is 21 days, so a fortnight would freeze cases
mid-flight in whatever status they held two weeks in. Their window slices are
30 days wide for the opposite reason: disputes and payouts number in the
hundreds a year, and a 7-day slice would spend most of its requests on empty
windows.

The payout window is over `created`, not `arrival_date`, even though arrival is
the date a reconciliation is done against. An arrival date *moves* while the
payout is in transit — a bank holiday pushes it — so a window over it re-reads a
moving target and can skip a payout that jumped past a window already closed.
Creation never moves.

## 8c. FX rates — a third shape, because a rate feed has neither of the two

Added 2026-08-24 with the FX plane (ADR 0007). It is not a mirror use case and
deliberately not forced into one: the blue history endpoint takes no parameters
and answers with all 5,700 days at once, so there is no window to slice and no
page to walk, and a rate is not a Provider object — it has no `platform` at all,
so calling it a gateway mirror would have meant inventing a platform number for
dolarapi. `SyncFxRatesUseCase` keeps what does transfer: resume from a
`fx:<source>` watermark, advance it only on a clean run, never be fatal.

Two things about its position in the order. It runs **after** the fee sync,
because the derived `'stripe'` rows are read out of `basket_payment_fees` and
running first would name a rate from before this run's charges landed. And it is
**not gated on `SYNC_GATEWAYS_ENABLED`**: the feed needs no credential, so a
deploy with no gateway keys still keeps its rates current. `SYNC_FX_ENABLED=false`
switches it off on its own.

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
- **The Stripe credential is read under two names.** The deployed environment
  holds the restricted key as `STRIPE_SERVICE_KEY`; every script and doc here
  says `STRIPE_SECRET_KEY`. Both are accepted, secret first. Renaming one side
  would unwire the whole gateway sync on whichever host was updated second, and
  it would do so silently — a missing credential is a skip, not a throw.
- **MercadoPago has no subscription link.** Its payments do not carry the
  preapproval id, so tying an MP charge to its subscription needs the preapproval
  search — a separate fetcher, not yet built. The column is honestly null rather
  than guessed from timing or amount.
- **`incomplete_expired` is not churn.** 8,811 of 51,830 subscriptions never
  completed a first payment. They are failed signups, not departed customers, and
  including them would inflate cancellations by roughly a quarter.
