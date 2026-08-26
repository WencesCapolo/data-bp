# Continue here: `/financiero`, from phase 2

You are picking up a port of `public/dashboard.html` — a frozen prototype — onto
live data. Phases 0, 1, 3 and 4 are done, phase 2 is half done, and the target has
not moved: **the same dashboard, the same shape, fresh numbers.** Where a live
figure disagrees with the prototype by more than a rounding, the prototype is a
specification of *shape*, not of value — chase the disagreement, do not copy the
number.

> **`public/dashboard.html` is gitignored — it is not in the repo.** It is 13,9 MB
> of real revenue figures and `public/` is served unauthenticated, so committing it
> would have published it at `https://analytics.basket-app.com/dashboard.html` with
> no SSO in front of it. It stays a local-only artifact: every doc here cites it by
> that path, and a fresh clone will not have it. Ask the owner for the file.

## Read first

- `docs/handoff/ship-gateway-fees-to-prod.md` — **start here if you are picking
  this up now.** Everything below is built and green in dev and none of it is in
  production, or even committed. That doc is the deploy: tree hygiene, the
  migration gate, the env flag, and the prod backfill in the one order that does
  not lose reversals.
- `docs/handoff/mp-allreport-history-and-finish.md` — done, 2026-08-26. Read its
  banner for what the six yearly exports settled; do not re-run its sections 1
  and 2.
- `docs/handoff/financiero-dashboard-port.md` — the master doc. State of play per
  phase, the six steps with their `done when`, and the trap list. **Everything
  below assumes you have read it**; this doc adds only what that one cannot know
  yet, and never restates it.
- `CONTEXT.md` — the words. **Pago**, **Subscriber**, **Provider**, **Export**,
  **Upload**, **Window**, **Tier**. The schema predates the language and says
  `gateway` where the language says Provider; keep `gateway` in identifiers and
  Provider in prose.
- `docs/adr/0005-gateway-fees-from-bulk-ledgers.md` — the two currency **planes**
  and why the fee **mirror** is keyed `(platform, platform_payment_id)`.
- `docs/adr/0006-gateway-sync-rides-the-analytics-cron.md` — the two sync
  **shapes** (windowed, full) and which one a new Provider feed takes.

## Before you touch anything

Two Postgres containers back this app, and both stop on their own. Every
`ECONNREFUSED` you will see — a 500 on `/financiero`, an `AggregateError` from a
script — is one of them being down, not a bug in the code you are reading.

```bash
podman start data-bp-postgres-1 basket-auth-db   # 5432 analytics, 5433 auth
pnpm smoke:gateway-net                           # every money invariant, all green
```

`auth_allowed_emails` lives in the **analytics** database, not the auth one, so a
session error can come from either container.

`pnpm dev` must be started as a **background** command; started in the foreground
it is killed when the tool call returns. The app is behind SSO, so a page you
open in a browser redirects (307) unless you hold a session; the API routes under
`/api` answer without one, which is how to check a DTO end to end.

## Steps

Take them in order. Each ends on a command whose output you can read, not on a
feeling that the work is done.

### 1. FX plane — **done 2026-08-24**

Built as the decision said: the Provider's own rate where it reports one, blue
(dolarapi `venta`, daily history) for ARS where none is reported. See
`docs/adr/0007-fx-rates-name-their-source.md` for why `source` is in the key, and
the master doc's step 3 for the file table. First load and verification:

```bash
pnpm backfill:fx        # 5,713 blue days (2011-01-03 → today) + 3,269 derived Stripe days
pnpm smoke:fx           # 16 checks, all green
```

Two things the build learned that the plan did not know:

**Stripe's `exchange_rate` is minor units per minor unit.** Applying it to our
major-unit `gross_amount` reconciled July 2024 to a third of a cent and the whole
mirror to *forty-four million dollars* out. CLP is the reason — it is
zero-decimal, so 1,000 CLP is 1,000 minor units and the rate is 100× off in that
one currency, while UYU, BRL, BOB and PEN all reconciled fine. Any read of that
column goes through `majorUnitRate()` in `infrastructure/gateways/money.ts`. With
it, 140,159 rows reconcile to 6.50 of drift on 1,694,195.77 settled.

**EUR has no source and is now the only gap.** dolarapi quotes ARS; Stripe leaves
EUR settled in EUR. So every EUR USD figure is `null` and the tab prints `—`
rather than zero, which hides 27,742 EUR of revenue behind an honest absence.
Naming a source for it is an owner decision, not a task — the table takes one
without a schema change. **Ask for it alongside the targets Sheet in step 3.**

### 2. MercadoPago — the Upload screen, then the three feeds

**The Upload screen takes the Cobros Export as of 2026-08-24.** What is left of
this step is the three feeds below, and each needs a file from a human.

| path | takes | shape |
|---|---|---|
| `SyncModal` → `/api/basket/payments/upload` → `/api/sync` | `.csv` | the Control Panel's **Pagos** Export |
| `FeeUploadModal` → `/api/basket/fees/{upload,ingest}` | `.csv` and `.xlsx` | the MP **Cobros** Export |
| `pnpm ingest:gateway-exports <file...>` | `.csv` and `.xlsx` | the same, from a terminal |

The two screens are one click apart (each links to the other) and two flows
underneath, which is the thing to keep straight if you touch either: a Pagos
Upload stages a CSV and runs a **full Sync**; a fee Upload writes
`basket_payment_fees` and rebuilds **one** view, and takes no Sync lock at all.
Routing the fee Export through `/api/sync` would rebuild the entire analytics
pipeline to record what a Provider charged us last month.

| piece | file |
|---|---|
| screen | `src/components/layout/FeeUploadModal.tsx`, reached from `SyncModal` |
| preview | `src/app/api/basket/fees/upload/route.ts` — stages, reads whole, writes nothing |
| confirm | `src/app/api/basket/fees/ingest/route.ts` — `IngestPaymentExportUseCase`, provenance, one view refresh |
| contract | `core/dtos/FeeUploadDTO.ts` — `FEE_EXPORT_SOURCES` is where a second Export is declared |
| verification | `pnpm smoke:fee-upload` — 17 checks against a live server, all green |

**The invariant check is not the check you would write.** `gross − fee − tax =
net` can never fail while the withholding is a *residual*: the adapter computes
tax as exactly what is left over, so a file where the `net` column moved balances
perfectly and reports MercadoPago as keeping half the money. What catches that is
the **ratio** — `taxPct > maxTaxPct` is its own rejection, `implausible_amounts`,
and the invariant is kept for the case it does catch, a negative residual (net
above gross). Both refuse before a row is written, and both now live in
`core/dtos/feeTotalsCheck.ts` because the SFTP inbox needs exactly the same two
checks with nobody looking at a preview.

Two more things the extension carries over from the CLI: the `.xlsx` reader is
`workbook.xlsx.readFile`, never `WorkbookReader` (see the traps), and the format
is decided by **sniffing the bytes**, never by the filename — a staged Upload has
no extension at all, and a workbook saved as `.csv` is the commonest way this
goes wrong.

**Puede que ninguno haga falta.** MP offers a *Reporte de todas las
transacciones* pushed to an SFTP server we run — no API credential involved, and
it likely carries the reversals the Cobros Export omits. That path has its own
doc: `docs/handoff/mercadopago-sftp-all-transactions.md`. **Two of its four steps
are built**: the SFTP landing zone (2026-08-24 — `mpreport`, jailed in
`/var/lib/mp-sftp`, port 22 unchanged) and the ingest that walks it
(2026-08-25 — `IngestExportInboxUseCase`, `RunSyncUseCase` step 8d, switched on by
`MP_SFTP_INBOX`, plus `pnpm ingest:gateway-exports <dir>`). What is missing is
**one sample file**: the adapter cannot be written against a column list nobody
has seen, and the inbox identifies files by their header, so adding it later is a
line in `resolveExportSource.ts`'s `READERS` map. Read that doc before building a
reversals adapter by hand.

**Decision, settled 2026-08-26: the report replaces Cobros, and the fee step was
never an artefact.** Six yearly ALLReports were ingested oldest window first, so
the history now runs 2021-03 → 2026-08 from one source. The 2024 report covers
July 2024, the month Cobros also covers, and the comparison the 2026-08-25
decision was waiting on came back unambiguous over all 10.056 shared operations:

| | expected if the report were Cobros + IVA | measured |
|---|---|---|
| `fee_ratio` | 1,21 | **1,0000** |
| `tax_ratio` | ≠ 1 | **1,0000** |
| `net_disagreements` | 0 | **0** |

The two Exports quote **the same figures, to the cent**. The step in the fee
series is inside the report itself and it is real — MercadoPago moved the IVA out
of the withholding line and into the commission line in August 2024:

```
2024-01 … 2024-07   1,78% commission · 5,0–5,9% withheld
2024-08             4,79% — the month it moved
2024-09 onward      7,50% commission WITH IVA · 3,4–3,5% withheld
```

So `smoke:gateway-net`'s 1–7,5% band **stays wide, and now for a stated reason**:
the account has had two prices, not two sources. Narrowing it would assert
otherwise. The check's comment carries the measurement.

**What this makes Cobros.** The historical importer of last resort, not a live
source. It is still the Upload screen's Export and still the only reader for a
`.xlsx`, but nothing in the mirror depends on it any more: every month it covers,
a report also covers. Prefer the report for any re-import.

**What the six files did not reach.** They start **2021-03-03**, not 2020-08 —
MP's panel returned nothing earlier, so the dashboard's 2020-10 → 2021-02 months
have Pagos but no fee rows. That is a gap to name on the tab, not a bug to chase.


Then the three feeds the Cobros Export cannot carry. Each is a separate Export
and a separate adapter behind `IPaymentExportSource`; `MercadoPagoCobrosExport.ts`
is the worked example — copy its shape, not its columns. Declaring one in
`FEE_EXPORT_SOURCES` is what puts it in the screen's picker.

- **Reversals — done 2026-08-26.** The Cobros Export carries `approved` **only**;
  the all-transactions report carries the movements. The six yearly files landed
  **589.546 operations and 25.721 reversals worth 113.179.863,67 ARS**, every year
  2021 → 2026 represented, where `SUM(refunded_amount)` for platform 0 had been
  zero across 27 months. `pnpm smoke:gateway-net` asserts it is not. Three things
  to know before touching that path: a window can hold a reversal *without* its
  charge (the `NO_CHARGE` guard in `DrizzleGatewayFeeRepository` is what stops
  such a row from erasing the charge), `CHARGEBACK_CANCEL` arrives with a positive
  amount and is not a second charge, and the mirror therefore has **two
  legitimate row shapes** — see the trap list.
- **Subscriptions.** `basket_gateway_subscriptions` holds Stripe alone. **The
  all-transactions report gives the missing half of the bridge for free**: 205 of
  332 rows in the first file carried a `preapproval_id` in `METADATA`, now stored
  as `basket_payment_fees.subscription_id`, so Pagos already point at their MP
  subscription — what is absent is the subscription rows themselves. The
  prototype's 79,639 MP Subscriptions live in the *planes de suscripción* Export,
  and the 143,577 hex32 ids in `basket_payments` are their Pagos. The seam here
  is **not** the money seam: `SUBSCRIPTION_PLATFORM` in
  `DrizzleAnalyticsQueryRepository` is Stripe-only on purpose, and widening it
  before the rows exist reports MP churn as zero rather than as absent.
  **As of 2026-08-26 the bridge is fully built and still only half a bridge:**
  460.947 of 589.546 fee rows carry a `subscription_id`, every year covered. The
  Pago → Subscription link is done; the Subscription's own row — plan, amount,
  `status`, `canceled_at` — has no source until the *planes de suscripción*
  Export arrives. Deriving one from the Pagos cannot tell *cancelled* from
  *lapsed*, which is the entire content of a churn number, so it does not meet
  this step's `done when`. **Ask for the file.**
- **Customers.** The email bridge, same role as `basket_gateway_customers` plays
  for Stripe. Lowest value of the three; do it last.

**Done when** — the first half holds: a Cobros Export uploaded through the screen
lands the same rows the CLI lands for that file, asserted by `pnpm
smoke:fee-upload`. What remains is that the Suscripciones tab can be built without a
`pendiente` badge: MP subscription rows exist, churn reads `status` rather than
`canceled_at`, and `SELECT SUM(refunded_amount) FROM basket_payment_fees WHERE
platform = 0` is non-zero.

### 3. Real vs Plan — still owed by a human

One answer outstanding: **the targets Sheet id and tab.** Ask for it as soon as
you reach this step, because nothing else here is blocked and the ask has a
lead time.

What to ask for, precisely — the sheet has to be shared read-only with the
service account that already reads the fixtures sheets,
`wenceslao@dashboards-496312.iam.gserviceaccount.com`, and then two env vars
follow the shape the other sheets already use:

```
GOOGLE_SHEETS_ID_TARGETS=<spreadsheet id from the URL>
GOOGLE_SHEETS_TAB_TARGETS=<tab name>
```

The tab's shape is fixed by what the prototype renders, so ask for it in the same
grain. `DATA.month_tracking_by_source` is a **daily** series per Provider inside
the current month:

```json
{"date":"2026-05-01","real":6484457.53,"plan":6380898.49,
 "prev_month_date":"2026-04-01","prev_month_real":6335714.18}
```

`real` and `prev_month_real` we compute. **`plan` is the only column the sheet
owes**, and `DATA.month_tracking_meta.currency_by_source` fixes its currency per
Provider — MercadoPago ARS, Stripe USD, PayPal USD — so the sheet states each
target in the Provider's own currency and nothing converts. Minimum columns:
`month` or `date`, `provider`, `plan`. If the owner keeps monthly targets rather
than daily ones, that is fine and worth asking outright: say which, and spread a
monthly target across the month's days rather than guessing that they meant
either.

**Done when** the current month shows real, plan and previous month per Provider,
and a month with no target row renders as absent rather than zero.

### 4. Asistente

Deferred, and still last: it needs a model and a query surface, and every number
it would quote comes from steps 1–3.

## What this codebase will bite you with

Each of these cost real debugging. They are not in the master doc's trap list
because they did not exist until phases 1, 2 and 4 landed.

**A commission is not a withholding.** MercadoPago deducts both and its Export
names only the first: commission is a flat **1.80%**, and the net sits **7.31%**
below gross. The gap is tax withheld at source, and it has no column in the file
— it exists only as the residual. `fee_amount` is the commission, `tax_amount` is
the withholding, and `gross − fee − tax = net` is asserted per file at ingest and
again in `pnpm smoke:gateway-net`. Fold the two together and MercadoPago reports
as costing four times what it charges, next to Stripe's 6.67%. A commission is
spent; a withholding comes back as tax credit.

**The fee mirror has two legitimate row shapes, and only one closes.** A file
that saw an operation's charge *and* its reversal folds both, so `gross − refunds
− fee − tax = net` holds on that row. When the reversal arrives in a **different**
Export from the charge, `upsertMany`'s `NO_CHARGE` guard keeps the charge's
commission, withholding and net — the whole point of the guard — and records the
reversal beside them, so that row misses the identity by exactly its own
`refunded_amount`. Six yearly reports produce 238 of them. A global `SUM` cannot
tell the two apart, which is why `smoke:gateway-net` asserts the identity **per
row, by shape**, and then checks that the aggregate gap is explained by those rows
and nothing else. Do not "fix" a failure here by widening a tolerance.

**A movement with no `TRANSACTION_TYPE` is not a Pago.** MercadoPago's monthly
commission invoice and its kin arrive in the all-transactions report as a
`TRANSACTION_AMOUNT` of zero carrying only a negative `FEE_AMOUNT`. Folded as
payments they produced 20 operations with a gross of zero and a fee of
**13.771.744,05 ARS**, 11,9 M of it in 2024 alone — a third of that year's real
commission, invented, and the per-file identity closes over them because
`net = −fee`. `isAccountAdjustment` in `MercadoPagoAllTransactionsExport` drops
them. They cannot be told apart by sign; the signal is the absent type, and across
all six files every untyped movement had amount zero and was the only movement its
`SOURCE_ID` had.

**A split reversal loses its first part.** `refunded_amount` is monotone under the
`NO_CHARGE` guard (`GREATEST`), deliberately — additive would double-count on a
re-read. But when one operation's refunds fall on both sides of a window edge, the
charge's file already folded the partial it saw and the later file's larger total
replaces rather than adds it. 8 rows at the 2021-10 seam, 82 ARS each, 656 ARS in
all. It is a limit of window-sliced Exports, not of the fold — no single file held
all three movements. `smoke:gateway-net` names and counts these rather than
hiding them; a wider periodic report is what would close it.

**The seam is two lines in two files.** `basket_mat_gateway_net_daily`'s
`WHERE platform IN (0, 4)` and `GATEWAY_PLATFORMS` in
`DrizzleAnalyticsQueryRepository`. A Provider added to one and not the other
gives a total that is right on the unfiltered path and wrong on the filtered one
— and both paths return numbers, so nothing throws. The list is a whitelist
rather than "every platform" because PayPal takes real money with no fee feed at
all: including it renders its transactions as costing nothing.

**Ask the email bridge with `EXISTS`.** Emails are not unique in `basket_users`,
so a `LEFT JOIN` on `LOWER(email)` multiplies each customer by however many
Subscribers share its address — it reported 38,193 customers against a true
38,170, and inflated the match count with it. `basket_users_lower_email_idx`
(migration 0016) is what keeps the semi-join at 1.5s instead of two minutes.

**Coverage needs its bucket.** MercadoPago has two id shapes: numeric ids are
payments and can carry a fee, the 143,577 hex32 ids are preapprovals and never
had one. A single coverage number over both is capped near 73% forever and reads
as a permanent loss. `FeeCoverageRow.idShape` is the bucket; keep it in anything
new that reports coverage.

**The content endpoint's `to` is exclusive.** A match dated exactly on `to` comes
back in no window, so abutting windows silently lose a day's matches at every
boundary while the total still looks plausible — 137 rows went that way before it
was caught. `backfill-content.ts` makes each window's `to` the next one's `from`;
the overlap costs a re-read and the upsert absorbs it. The same off-by-one hid in
the cron, where `to = now` meant today's matches only ever arrived tomorrow.
Check for it by re-running and asking whether any row went untouched:
`SELECT COUNT(*) FROM basket_content WHERE synced_at < NOW() - INTERVAL '3 minutes'`.

**The catalogue filter is load-bearing.** Contenido counts `status = 1` rows
averaging at least 60 seconds watched per view, which is what
`DATA.content.filter` in the prototype records. Drop it and the row count jumps a
quarter and every average sags. It is served as data (`ContenidoDTO.catalogue`)
so the view can report what each rule cost — 25,375 rows in range become 20,377,
with 1,828 unpublished and 3,090 too short.

**Content country is not Subscriber country.** `getContenido` takes its own
`from`/`to`/`country` instead of `DateRange` + `CommonFilters`, and
`ContenidoQuerySchema` deliberately does not reuse `commonFiltersShape`. Wiring
the shared country filter in would answer an audience question with a billing
filter and still return a number.

**`tournament_id = 0` is the no-tournament sentinel**, not a broken join. 89
content rows carry it, `basket_tournaments` has no row 0, and the prototype lists
it among its 101 tournaments — so label it, do not drop it.

**The cruces stop at 2024-05.** Pagos start 2024-05-22, so the audience-vs-actives
pair covers 25 of the catalogue's 65 months. The view says so; leave the axis
starting where the audience does, rather than at 2024 where it would imply the
audience began then too.

**ExcelJS streams cannot read MercadoPago's workbooks.** `WorkbookReader` fails
with `invalid signature: 0x41d` before the first row; `workbook.xlsx.readFile`
reads the same file. Monthly Exports are ~2 MB and released between files, so the
ceiling is one month at a time. If a file ever arrives too large for that, ask
the panel for a narrower Window — it offers one — rather than re-trying the
stream reader.

**Dates in MP Exports are day-first.** `31/07/2024`. `Date.parse` reads that as
month-first and silently moves every payment before the 13th into the wrong
month; `MercadoPagoCobrosExport.parseDate` is where that is handled.

**A rate is a day's rate.** The blue moved 9.5% inside July 2024 and 1,000 →
1,565 over the span the Pagos cover, so converting a month's total at a month rate
is a different number, not a rounding of the right one. `core/services/
usdConversion.ts` is the only place a conversion happens and it reads the DAY
grain, which both query paths already return; a converted figure pre-aggregated
into a mat view would freeze at whatever rates the last refresh saw.

**`db.execute` returns timestamps as strings.** The typed generic on it is a
claim, not a conversion — `new Date(...)` at the mapping boundary or `.toISOString()`
throws at runtime while typechecking clean.

**Bind dates as ISO strings.** A `Date` object interpolated into a drizzle `sql`
template fails with `The "string" argument must be of type string`; pass
`d.toISOString()` and cast `::timestamptz` in the query.

## What is owed by a human, not by you

- The targets Sheet id and tab (step 3), shared with
  `wenceslao@dashboards-496312.iam.gserviceaccount.com`.
- ~~A source for EUR/USD~~ — **answered 2026-08-26.** The same host that serves
  the blue history also serves daily *oficial* quotes for EUR/ARS and USD/ARS, so
  EUR→USD is their cross and the ARS leg cancels:
  `ArgentinaDatosEurUsdFetcher`, source `oficial_cross`, no new dependency and no
  key. 27.742 EUR of revenue now reads **29.678,78 USD**. Two things in that file
  are load-bearing and neither is a preference: both legs must come from the
  **oficial** table (crossing a blue USD leg with an oficial EUR leg invents a 30%
  error), and a cross outside 0,5–2,0 is refused — the source published a EUR leg
  of `1` on 11 days in July 2024, which crosses to 940 EUR/USD and would have
  multiplied that week's EUR revenue by a thousand.
- **The *planes de suscripción* Export — one real file.** This is now the single
  thing between the Suscripciones tab and done. Reversals arrived and are ingested
  (2026-08-26); the *clientes* bridge is still last and lowest value. Ask for one
  file before any adapter is written for it: every column name is an assumption
  until a real file exists, which is the discipline that saved the reversals feed.
- **Whether production starts reading the SFTP inbox.** `MP_SFTP_INBOX` is unset
  in prod, so `RunSyncUseCase` step 8d does not exist there and the daily reports
  pile up unread in `/var/lib/mp-sftp/inbox` (10 files as of 2026-08-26). Setting
  it plus a restart of the `analytics` pm2 app is the whole change — but the box
  is shared with 12 other apps, so confirm before touching it.
- **Whether the panel also sends a wider periodic report** beside the daily one.
  A refund and its cancel only net out inside a file whose window holds both; a
  daily file cannot hold a chargeback raised three weeks after the charge. This
  is what the 238 kept-charge rows and the 8 split reversals are.

Ask when you reach the step. Step 1 waits on neither.
