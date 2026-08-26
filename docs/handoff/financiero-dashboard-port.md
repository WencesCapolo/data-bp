# Handoff: `/financiero`, phases 1–6

`/financiero` reproduces `public/dashboard.html` — a frozen prototype — against
the live database, and replaces the daily hand-uploaded Exports that fed it.
Phase 0 shipped. This is the doc for whoever takes 1–6.

**Continuing this work rather than reading it?** Start at
`docs/handoff/financiero-continue-here.md` — the ordered next steps, the traps
phases 1 and 2 added, and the two answers still owed by the product owner. This
doc stays the reference it points back to.

`/basket` is **out of scope**: its *Análisis Financiero* tab and
`/api/basket/finance` are byte-identical to what they were before this work and
stay that way. `/financiero` owns the net-revenue half.

## Read first

- `CONTEXT.md` — the words. Use them: **Pago**, **Subscriber**, **Provider**,
  **Export**, **Upload**, **Window**, **Tier**. Note the schema predates the
  language and says `gateway` where the language says Provider
  (`basket_gateway_subscriptions`, `GatewayNetDTO`); keep `gateway` in
  identifiers, Provider in prose.
- `docs/adr/0005-gateway-fees-from-bulk-ledgers.md` — the two currency **planes**
  and why the fee **mirror** is keyed `(platform, platform_payment_id)`.
- `docs/adr/0006-gateway-sync-rides-the-analytics-cron.md` — how Provider rows
  arrive today, and where a new fetcher plugs in.
- `docs/adr/0007-fx-rates-name-their-source.md` — the FX plane: why `source` is
  in the key, and why a conversion happens per day and in exactly one function.
- `docs/handoff/mercadopago-gateway-sync.md` — the MP half. Its §5 traps outlive MP.
- `docs/handoff/finance-dashboard-stripe-first.md` — the plane rule as a table,
  and the verification SQL `pnpm smoke:gateway-net` automates.

Three words carry the design. **Plane**: presentment (what the Subscriber was
charged) versus settlement (what the Provider moved) — same-plane arithmetic
only, always. **Mirror**: a table rebuildable from the Provider at any time,
never a source of truth. **Seam**: the one predicate that decides which Providers
a view covers, written once so widening it is a one-line change.

## State of play

Phase 0 is live: `/financiero` behind `requireDashboard('financiero')`, the
landing card flipped `soon` → `live` in `src/lib/dashboards.ts`, and the
**Economía** tab.

| piece | file |
|---|---|
| page + tab shell | `src/app/financiero/{page,FinancieroDashboard}.tsx` |
| Economía tab | `src/components/financiero/EconomiaTab.tsx` |
| DTOs | `src/modules/basket/core/dtos/{EconomiaDTO,GatewayNetDTO}.ts` |
| query | `DrizzleAnalyticsQueryRepository.getEconomia` / `.getGatewayNet` |
| endpoint | `src/app/api/financiero/economia/route.ts` |
| the seam | `basket_mat_gateway_net_daily` in `migrations/sql/0001_views.sql` (`WHERE platform IN (0, 4)`) |
| verification | `scripts/smoke-gateway-net.ts` — 30 checks, all green |

Phase 1 is **done**. A working restricted key landed on 2026-08-21 and all five
Stripe Exports reproduce from the API alone for July 2026 — pagos 8,372,
clientes 711, suscripciones 1,669, disputadas 2 (+20 refunds), transferencias 12,
each matching its mirror exactly. Loaded: 38,170 customers, 282 disputes and 560
payouts back to 2021-01. The customer mirror's own measure is the email bridge,
not the row count: 34,579 of 38,170 reach a Subscriber (90.6%).

| piece | file |
|---|---|
| tables | `basket_gateway_{customers,disputes,payouts}` in `migrations/sql/0014_*.sql` (applied) |
| fetchers | `Stripe{Customer,Dispute,Payout}Fetcher.ts` |
| the two shapes | `SyncGatewayMirrorUseCase.ts` — `Window` and `Full`, generic over the row |
| cron | step 8b in `RunSyncUseCase`, wired in `composeGatewayFeeSync` |
| first load | `pnpm backfill:stripe-ledger --from=YYYY-MM-DD` |
| verification | `pnpm smoke:stripe-exports --from=… --to=…` — the five Export counts, API vs mirror |

Phase 2's **fee half is built and one month is loaded.** The MP *Cobros* Export
reads end to end — 10,056 Pagos for July 2024 — and the seam in
`basket_mat_gateway_net_daily` is widened to `platform IN (0, 4)`. What is left
is volume, not code: the panel caps a report's span, so the other 26 months come
as 26 more files through the same command.

| piece | file |
|---|---|
| the port | `IPaymentExportSource` — one Export, one source; a CSV/xlsx adapter now, an API adapter later |
| MP adapter | `MercadoPagoCobrosExport.ts` — reads .xlsx and .csv, matches the machine names in the header |
| ingest | `IngestPaymentExportUseCase` → `pnpm ingest:gateway-exports [--refresh] <file...>` |
| tax column | `migrations/sql/0015_fee_tax_amount.sql` |
| the seam, widened | `basket_mat_gateway_net_daily` (`platform IN (0, 4)`) and `GATEWAY_PLATFORMS` in the query repo — **two lines in two files that must agree** |
| verification | `pnpm smoke:gateway-net` — 30 checks, all green with MP in the totals |

**The finding that changed the schema.** MercadoPago's commission is a flat
**1.80%**, and its net is **7.31%** below gross. The difference is tax withheld
at source, for which the Export has no column at all — it exists only as the gap.
July 2024: gross 75,011,659.00 ARS, commission 1,350,189.76, withholding
4,135,643.02, net 69,525,826.22. So `tax_amount` is its own column and
`gross − fee − tax = net` is an invariant the smoke script asserts. Folding the
withholding into the fee would have been simpler and would have reported MP as
costing four times what it charges: a commission is spent, a withholding comes
back as tax credit.

**MP coverage is bucketed by id shape**, as the step below asks: 9,651 of 306,587
fee-bearing Pagos carry a fee today (one month of 27), and the 11,398 hex32
preapprovals are reported separately at 0 because they are subscriptions and
never had a commission to report. One number over both would sit near 73%
forever and read as a permanent loss.

**The Upload screen takes the Cobros Export as of 2026-08-24** — `FeeUploadModal`
→ `/api/basket/fees/{upload,ingest}`, verified by `pnpm smoke:fee-upload`. It is
deliberately not routed through `/api/sync`: a fee Export writes one table and
rebuilds one view, while a Pagos Upload runs the whole pipeline.

**What phase 2 still owes:** the *planes de suscripción* Export, which is where the
prototype's 79,639 MP Subscriptions live and which no table holds yet; the
*clientes* Export; and a source for MP's refunded and charged-back Pagos — the
Cobros report carries only `approved`, so July 2024's 69 refunds and 19
chargebacks are absent from the mirror while being present in `basket_payments`.

Two more things phase 1 decided that later phases inherit. **Refunds got no table**:
they already live on the charge as `refunded_amount`, so the devueltas/disputadas
Export is half mirrored and half already-present, and the smoke script prints the
refund count beside the dispute count rather than pretending the table covers it.
**`STRIPE_SECRET_KEY` and `STRIPE_SERVICE_KEY` are both read**, secret first —
see ADR 0006's consequences.

The **Contenido** view is live as of 2026-08-21 — see step 4. **Suscripciones**
still renders a `pendiente` badge and no numbers, and stays that way until the
MercadoPago *planes de suscripción* Export has a table: it is blocked on data,
not on UI.

`/financiero` now navigates the way the prototype does: **pills switch the view**
(Financiero · Contenido), and tabs sit inside a view. The two levels are not
interchangeable — Contenido shares no filter and no axis with Economía, and
flattening both into one six-item bar read as though it answered the same
question with a different chart.

Measured 2026-08-21, and the reason there is no single revenue number anywhere —
three Providers, three currencies, no FX, and now two different *kinds* of
deduction:

| Provider | ccy | gross | commission | withheld | net |
|---|---|---:|---:|---:|---:|
| Stripe | USD | 2,111,911.66 | 140,822.80 (6.67%) | — | 1,971,088.86 |
| Stripe | EUR | 27,742.02 | 1,129.99 (4.07%) | — | 26,612.03 |
| MercadoPago | ARS | 75,011,659.00 | 1,350,189.76 (1.80%) | 4,135,643.02 (5.51%) | 69,525,826.22 |

Stripe fee coverage 174,962 of 182,894 Pagos with a Provider id = 95.7%. MP
coverage 9,651 of 306,587 fee-bearing Pagos — one month of 27 ingested, so this
figure is a progress bar, not a defect.

## What the prototype needs that the database lacks

> **`public/dashboard.html` is gitignored — it is not in the repo.** It is 13,9 MB
> of real revenue figures and `public/` is served unauthenticated, so committing it
> would have published it at `https://analytics.basket-app.com/dashboard.html` with
> no SSO in front of it. It stays a local-only artifact: every doc here cites it by
> that path, and a fresh clone will not have it. Ask the owner for the file.

`public/dashboard.html` is 13.9 MB, of which 13.5 MB is one embedded
`const DATA = {…}` stamped `2026-05-18T07:29`, built by an external Python job
over the Exports. Read its keys with a balanced-brace scan and `eval` — parsing
it is a five-minute job and worth doing before designing any phase.

Its own totals: MP 79,639 Subscriptions (18,259 active), Stripe 47,346 (10,409),
PayPal 90 (42); content 20,384 matches across 101 tournaments, back to 2021-09.

| prototype block | live source | state |
|---|---|---|
| `monthly_revenue`, `daily_revenue` (gross by country×currency) | `basket_mat_revenue_daily` | **served** |
| `monthly_revenue_net`, `monthly_fees`, `daily_fees` | `basket_payment_fees` | **Stripe + MP** — MP is one month of 27; PayPal has no source and stays gross-only |
| `catalog` (plan×market×currency×season×price) | derived in `getEconomia` | **served** |
| `monthly_stats`, `daily_stats` (altas/reactivados/bajas by country×plan) | `basket_payments` | **derivable** — `basket_mat_monthly_lifecycle` has the logic, not the country×plan×bucket grain |
| `monthly_active_subscribers`, `active_now_snapshot` | `basket_mat_daily_active` | **derivable** — needs country×Tier×Period splits |
| `daily_recent` (15d), `daily_recent_by_country`, `period_comparison` | `basket_payments` | **derivable** |
| `subs_proc.*` (totals, active now, last-charge buckets, lifetime) | `basket_gateway_subscriptions` | **Stripe only** |
| `*_usd`, `*_net_usd`, `monthly_fees_usd` | `basket_fx_rates` | **served for ARS and USD** — EUR has no source and renders absent |
| `month_tracking_by_source` (Real vs **Plan**) | — | **missing**: no target feed |
| `content.*` (views, users, by country/tournament/team, tops) | `basket_content` | **served** — `getContenido`, 22,357 kept rows |
| asistente (chat) | — | **missing** |

## Decisions already made (2026-08-14, by the product owner)

- **MP arrives through the Upload UI**, extending the Pagos screen — *and* the
  ingestion is shaped so the API replaces the Upload without a rewrite: one port
  per MP Export, a CSV adapter behind it now, an API adapter later. When
  credentials land, the Upload screen goes; the tables and mappers stay.
  Reaffirmed 2026-08-24: **the 26-month bulk download is off the table**, Cobros
  Exports arrive one at a time through the screen. The screen does not take them
  yet — it accepts `.csv` and the Pagos shape only, while the fee ingest lives in
  `pnpm ingest:gateway-exports`. Closing that gap is the first half of step 2.
- **FX = the Provider's own rate where it reports one** (Stripe reports
  `exchange_rate` per balance transaction, already mirrored), **blue rate for
  ARS** where none is reported. The series is **dolarapi**, answered 2026-08-24:
  `dolarapi.com/v1/dolares/blue` for spot, `dolarapi.com/v1/dolares/oficial` if a
  figure ever needs the official rate, and
  `api.argentinadatos.com/v1/cotizaciones/dolares/blue` for the daily history
  (5,712 rows, 2011 → today, every calendar day). The history is the one that
  matters: a 2024 Pago converts at its own day's rate, never at today's.
- **Targets come from a Google Sheet**, read by the service account that already
  reads the fixtures sheets.
- **PayPal stays gross-only** — 90 Subscriptions, no fee feed. It appears in
  gross revenue and is labelled as excluded from every net figure, rather than
  counted as costing nothing.

One answer is still owed by the human, and only phase 5 needs it: the Sheet id +
tab holding the targets, shared read-only with
`wenceslao@dashboards-496312.iam.gserviceaccount.com`. The sheet owes exactly one
column — `plan`, per Provider, in that Provider's own currency
(`month_tracking_meta.currency_by_source`: MP ARS, Stripe USD, PayPal USD); real
and previous-month we compute. Ask when you reach the phase; no earlier phase
waits on it.

## Steps

Take them in order — each later phase reads tables the earlier ones create. Every
criterion below is a command or a query with a stated answer, so "done" is
checkable rather than felt.

1. **Stripe API, full.** *Built 2026-08-14; blocked on a working key — see State
   of play.* Extend `StripeFeeFetcher` / `StripeSubscriptionFetcher`
   to the three Exports nothing fetches yet: clientes (customer ↔ email),
   transacciones devueltas/disputadas (refunds carry `refunded_amount` already;
   disputes have no column), transferencias (payouts — no table exists). Mirror
   each keyed the way `basket_payment_fees` is; ride the analytics cron per ADR
   0006. *Done when* a smoke script reproduces all five Stripe Exports' row
   counts for one Window from the API alone, and the disputes and payouts tables
   answer "which charges were reversed" and "what hit the bank on date X" with no
   CSV in the loop.
2. **MercadoPago ingestion.** *Fee half landed 2026-08-21 and the Upload screen
   takes it as of 2026-08-24; one month ingested, 26 to go — see State of play.* Three MP Exports — cobros aprobados (carries the
   fee), planes de suscripción, clientes — behind one port each, CSV adapter now.
   Follow `scripts/ingest-payment-exports.ts` for the mapper/upsert/provenance
   shape and `basket_payment_uploads` for provenance. Then widen the **seam** in
   `basket_mat_gateway_net_daily` to include `platform = 0` and rebuild. *Done
   when* `SELECT COUNT(*) FROM basket_payment_fees WHERE platform = 0` is
   non-zero, MP fee coverage is reported **bucketed by id shape** (numeric ids can
   carry a fee; the 143,577 hex32 ids are preapprovals and belong to the
   Subscriptions table), and `pnpm smoke:gateway-net` still passes with MP in the
   totals.
3. **FX plane.** *Done 2026-08-24. See ADR 0007 and the table below.* `basket_fx_rates` keyed `(day, base_currency, quote_currency, source)`
   plus the conversion; `source` because Stripe rows convert at Stripe's own rate
   and a table that cannot say which rate produced a number cannot answer the
   question the tab asks. Rates are ARS per USD and the history carries `compra`
   and `venta` — revenue arriving is a sale of dollars, so `venta` is the
   defensible default, named in the column comment.
   *Done when* one month's converted total reconciles against Stripe's own
   `exchange_rate` to the cent for Stripe rows, and every USD figure on the tab
   says which rate produced it. Both hold: `pnpm smoke:fx` reconciles 140,159
   Stripe rows to 6.50 of drift on 1,694,195.77 settled — half a hundredth of a
   cent per row — and each `usdTotals` row carries its own `rateLabel`.

   | piece | file |
   |---|---|
   | table | `basket_fx_rates` in `migrations/sql/0017_fx_rates.sql` (applied) |
   | blue feed | `infrastructure/fx/DolarApiBlueFetcher.ts` — history + spot |
   | derived Stripe rows | `DrizzleFxRateRepository.refreshDerivedStripeRates` |
   | the one conversion | `core/services/usdConversion.ts` — day grain, both query paths |
   | DTO | `UsdSettlementTotal` / `UsdMonthlyPoint` in `GatewayNetDTO.ts` |
   | cron | step 8c in `RunSyncUseCase`, wired by `composeFxRateSync` |
   | first load | `pnpm backfill:fx` — 5,713 blue days, 3,269 derived Stripe days |
   | verification | `pnpm smoke:fx` — 16 checks, all green |

   **EUR is the one thing left open, and it is a question rather than a task.**
   dolarapi quotes ARS and Stripe leaves EUR settled in EUR, so no source quotes
   EUR/USD: its USD figures are `null` and the tab prints `—`. 27,742 EUR of
   revenue is what that hides. Naming a source for it is the owner's call, and
   the table takes one without a schema change.
4. **Content history.** *Done 2026-08-21.* `pnpm backfill:content` walks the
   content endpoint in 3-month windows and upserts by content id, so it is safe
   to re-run over any range. History reaches back further than the prototype's
   2021-09: the first real match is **2020-10-20**, and one row is dated 2004
   (created 2024 — a typo in the source), which is why a default run sweeps
   everything before `HISTORY_START` in one leading window. 27,549 rows,
   112 tournaments, all 101 the prototype names among them; by year
   2020:14 · 2021:904 · 2022:3,965 · 2023:3,862 · 2024:6,463 · 2025:7,704 ·
   2026:4,636. The cron keeps the 30-day tail fresh as before.

   **The Contenido view is built on top of it.** One endpoint, one query set,
   the prototype's layout in the app's dark palette.

   | piece | file |
   |---|---|
   | view | `src/components/financiero/ContenidoView.tsx` + `contenido/{ContenidoFilters,ComboChart,GroupedBarChart,format}` |
   | DTO | `src/modules/basket/core/dtos/ContenidoDTO.ts` |
   | query | `DrizzleAnalyticsQueryRepository.getContenido` — three grains in one grouping-sets scan, ~1.6s on the whole catalogue |
   | endpoint | `src/app/api/financiero/contenido/route.ts` (`ContenidoQuerySchema`) |
   | pill nav | `FinancieroDashboard.tsx` |

   **The catalogue filter is the prototype's, reproduced rather than guessed.**
   `DATA.content.filter` records it: `status = 1` and at least 60 seconds watched
   per view. Without it the row count is a quarter higher and every average is
   dragged down by trailers, test emissions and aborted streams. It is served as
   data (`catalogue`), not hidden in the SQL, so the tab can say *how many* rows
   each rule cost. Against the prototype's own window, the agreement is close
   enough to call the port done: 20,377 pieces against its 20,384, 20,445,889
   views against 20,410,911, and the top content — Atenas Córdoba vs Racing
   Chivilcoy, 2024-06-21 — identical to the view.

   **What the cruces cannot reach.** Pagos start 2024-05-22, so the
   audience-vs-actives series can only draw 25 of the catalogue's 65 months. The
   view says so rather than starting the axis at 2024 and implying the audience
   did too.
5. **Real vs Plan.** The targets Sheet, then the mes-en-curso section.
   *Done when* the current month shows real, plan and previous month per Provider,
   and a month with no target row renders as absent rather than zero.
6. **Asistente.** Deferred: it needs a model and a query surface, and every
   number it would quote comes from phases 1–5.

## Traps

- **A commission is not a withholding.** MercadoPago deducts both and the Export
  names only the first. `fee_amount` is the commission; `tax_amount` is the
  withholding; `net_amount` is what arrived. Summing fee across Providers to
  compare their pricing is fair; summing fee+tax and calling it "cost of
  payments" is fair too — but doing the second and labelling it the first makes
  MP look four times more expensive than Stripe when it is in fact cheaper.
- **Same-plane arithmetic only.** `fee_amount / gross_amount` on a UYU row reads
  0.16% because the fee is USD and the gross is UYU. Divide by
  `settlement_amount`. `refunded_amount` sits among the settlement columns but is
  **presentment** — the single easiest thing here to get wrong.
- **Never sum `refunded_amount` across currencies.** 720 of the 1,033 refund rows
  exceed their own `settlement_amount`. Correct, not corrupt.
- **Churn reads `status`, not `canceled_at`.** 15,636 of 34,093 canceled
  Subscriptions carry no `canceled_at`; bucketing on it drops 46% of them.
- **Two clocks.** `basket_payments.created_at` is Argentina local time stored as
  UTC; `basket_payment_fees.captured_at` is true UTC — a 3-hour skew. Joins are by
  Provider id and unaffected; anything bucketing both tables by month misplaces
  transactions at month boundaries. Pick one clock per view and name it in a
  comment, as `basket_mat_gateway_net_daily` does.
- **Filtering reaches fewer fee rows than the mirror holds.** A filter is a
  predicate on the Pago, so the filtered path sees only fee rows whose Pago is
  ingested and whose Subscriber is known: 174,962 of 183,637. `getGatewayNet`
  reports that as `netExcludesUnmatchedFees` and the tab says so. Keep the
  unfiltered headline reading the whole mirror.
- **MP credentials are blocked** outside this repo — `MP_ACCESS_TOKEN` is a test
  user's token, not the integration's. The CSV path stays working after the API
  lands: the Exports are the only history for anything the API windows out.
- - **Stripe's `exchange_rate` is minor units per minor unit.** Multiplying our
  major-unit `gross_amount` by it reads CLP 100× high — CLP is zero-decimal, so
  1,000 CLP is 1,000 minor units — and every two-decimal currency reconciles
  fine, which is how the error hid inside a plausible-looking total. Go through
  `majorUnitRate()` in `infrastructure/gateways/money.ts`.
- **Convert per day, never per month.** The blue rate moved 9.5% inside July 2024
  alone and 1,000 → 1,565 over the period the Pagos cover, so a month rate is not
  a rounding of a day rate. `usdConversion.ts` is the only place a conversion
  happens; keep it that way.
- **The prototype's numbers are frozen at 2026-05-18.** They specify *shape*, not
  value. Where live figures disagree by more than a rounding, chase the
  disagreement — the prototype's own coverage figure (96.2%) contradicted its own
  per-currency table (95.7%), and the table was right.
- **Coverage moves when Pagos are ingested**, not only when fees are. A drop
  usually means new Pagos arrived.
- **The content endpoint's `to` is exclusive.** A match dated exactly on `to`
  comes back in no window. Abutting windows therefore lose one day's matches at
  every boundary and the total still looks plausible — 137 rows went missing this
  way before it was caught. `backfill-content.ts` makes each window's `to` the
  next one's `from`; the overlap costs a re-read and the upsert absorbs it. The
  same off-by-one hid in the cron, where `to = now` meant today's matches only
  ever arrived tomorrow.
- **`tournament_id = 0` is the no-tournament sentinel**, not a missing join: 89
  content rows carry it and `basket_tournaments` has no row 0. The prototype
  lists it among its 101 tournaments, so the tab must label it rather than drop
  it.
