# Handoff: finance dashboard, Stripe-only

**Goal.** Turn the *Análisis Financiero* tab from gross-revenue-only into net
revenue: fees, net, refunds and subscription churn — reading `basket_payment_fees`
and `basket_gateway_subscriptions`, **Stripe only** (`platform = 4`).

MercadoPago is excluded by an explicit predicate at one **seam**, not by accident.
Its fee mirror is empty (0 rows) and blocked on a credential outside this repo, so
every MP number would silently render as zero revenue. When MP lands, flipping the
seam is a one-line change plus a view rebuild.

---

## 0. Read first

- `docs/adr/0005-gateway-fees-from-bulk-ledgers.md` — the two currency **planes**,
  and why the fee mirror is keyed `(platform, platform_payment_id)`.
- `docs/adr/0006-gateway-sync-rides-the-analytics-cron.md` — how fee/subscription
  rows arrive.
- `docs/handoff/mercadopago-gateway-sync.md` — the MP half. §5 lists traps that
  outlive MP and bite this dashboard too.

The planes rule is the one thing not to get wrong.

| plane | columns | means |
|---|---|---|
| **presentment** | `currency`, `gross_amount`, `refunded_amount` | what the subscriber was charged; reconciles against `basket_payments.amount` |
| **settlement** | `settlement_currency`, `settlement_amount`, `fee_amount`, `net_amount` | what Stripe actually moved |

Fees exist only in the settlement plane. `refunded_amount` sits in the
**presentment** plane despite living next to the settlement columns — that
asymmetry is the single easiest thing to get wrong in this work.

---

## 1. What already exists

| piece | file | state |
|---|---|---|
| tab shell | `src/components/tabs/FinanceTab.tsx` | 193 lines, gross only: revenue by day, platform doughnut, stacked monthly |
| DTO | `src/modules/basket/core/dtos/FinanceDTO.ts` | `revenueByDay`, `byPlatform`, `byCurrency`, `platformMonthly` |
| use case | `.../use-cases/queries/GetFinanceUseCase.ts` | pass-through to the repo |
| query | `DrizzleAnalyticsQueryRepository.getFinance` / `getFinanceFiltered` | unfiltered path reads `basket_mat_revenue_daily`; filtered path scans the view once and splits with `GROUPING SETS` |
| route | `src/app/api/basket/finance/route.ts` | BFF: one endpoint, DTO shaped per tab |
| views | `migrations/sql/0001_views.sql` | 5 materialized views; `basket_mat_revenue_daily` at line 332 |
| fee mirror | `migrations/sql/0012_gateway_fees.sql`, `0013_gateway_subscriptions.sql` | tables exist, nothing reads them yet |

Follow the existing shape: SQL does the aggregation, the endpoint returns exactly
what the tab renders, the repo keeps a filtered and an unfiltered path at parity.

## 2. Data on the ground (measured 2026-08-14)

`basket_payment_fees`, `platform = 4`, 183,637 rows, `captured_at` 2024-05-21 →
2026-08-12.

Settlement plane, the only place a fee ratio is meaningful:

| settlement | rows | gross | fees | net | fee % |
|---|---|---|---|---|---|
| USD | 181,256 | 2,111,911.66 | 140,822.80 | 1,971,088.86 | 6.67% |
| EUR | 2,381 | 27,742.02 | 1,129.99 | 26,612.03 | 4.07% |

Presentment currencies: UYU 85,827 · CLP 41,249 · USD 41,097 · BRL 10,028 ·
BOB 2,571 · EUR 2,381 · PEN 484.

Fee coverage against successful Stripe Pagos carrying a gateway id — 174,962 of
182,894, **95.7%** (measured 2026-08-14; the 175,891 / 96.2% first written here
did not agree with this table's own rows, which sum to 174,962):

| currency | successful | with fee | % |
|---|---|---|---|
| UYU | 85,979 | 82,623 | 96.1 |
| CLP | 41,993 | 38,976 | 92.8 |
| USD | 40,117 | 38,857 | 96.9 |
| BRL | 9,597 | 9,409 | 98.0 |
| BOB | 2,448 | 2,431 | 99.3 |
| EUR | 2,262 | 2,199 | 97.2 |
| PEN | 498 | 467 | 93.8 |

`basket_gateway_subscriptions`, `platform = 4`, 51,830 rows:

| status | rows | with `canceled_at` |
|---|---|---|
| canceled | 34,093 | 18,457 |
| incomplete_expired | 8,811 | 3,771 |
| active | 8,697 | 0 |
| past_due | 227 | 0 |
| incomplete | 2 | 0 |

`subscription_id` is populated on only 951 fee rows and `invoice_id` on 1,034 —
one-off charges have no invoice at all, so a per-subscription revenue view covers
a sliver of the data. Treat subscription revenue as a separate, small question
from subscription churn, which has all 51,830 rows.

## 3. Traps

- **Never divide across planes.** `fee_amount / gross_amount` on a UYU row reads
  0.16% because the fee is USD and the gross is UYU. Same-plane only:
  `fee_amount / settlement_amount`.
- **Never sum `refunded_amount` across currencies.** It is presentment-plane; a
  naive sum mixes 1,003,000 CLP into a USD total. 1,033 rows carry a refund, 720
  of them exceed their own `settlement_amount` — correct, not corrupt.
- **`canceled_at` is null on 15,636 canceled subscriptions.** Churn reads
  `status`, not `canceled_at`. A churn chart bucketed on `canceled_at` silently
  drops 46% of cancellations.
- **`basket_payments.created_at` is Argentina local time stored as UTC;
  `basket_payment_fees.captured_at` is true UTC** — a 3-hour skew. Joins are
  unaffected (they go by gateway id) but any view bucketing both tables by month
  misplaces transactions near month boundaries. Pick one clock per view, name it
  in a comment, and bucket everything in that view on it.
- **No FX exists.** Nothing converts ARS or UYU to USD; `basket_fx_rates` is
  unbuilt. A single-number "total revenue" across currencies is not available —
  report per currency, or per settlement currency where the plane allows it.
- **Coverage moves when Pagos are ingested**, not only when fees are. A drop in
  the coverage figure usually means new Pagos arrived.

## 4. Steps

Each step ends on a checkable condition. The verification SQL in §5 is the bar
for steps 2 and 6.

1. **Extend the DTO.** Add net-revenue and churn shapes to `FinanceDTO.ts`:
   fees/net by settlement currency and by month, refunds by presentment currency,
   subscription counts by status and by month. *Done when* every new field has a
   named interface and the tab's needs are expressible without a second endpoint.
2. **Add one materialized view** to `migrations/sql/0001_views.sql`, next to
   `basket_mat_revenue_daily` — suggested `basket_mat_gateway_net_daily`, grain
   `(day, platform, settlement_currency)` bucketed on `captured_at`, carrying
   `gross_settlement`, `fees`, `net`, `tx_count`, and presentment refunds kept in
   their own `(day, currency)` grain. Gate it with `WHERE platform = 4` — that is
   the **seam**. *Done when* `pnpm views:apply && pnpm views:refresh` succeeds and
   the totals in §5 match to the cent.
3. **Implement the query** in `DrizzleAnalyticsQueryRepository`, both paths:
   unfiltered off the new view, filtered following the existing `GROUPING SETS`
   pattern. *Done when* filtered and unfiltered agree for a range with no active
   filters.
4. **Widen the endpoint.** `GetFinanceUseCase` stays a pass-through; the route
   keeps returning one DTO. *Done when* `pnpm smoke:api` passes.
5. **Build the UI** in `FinanceTab.tsx`, reusing `KpiCard`, `LineChart`,
   `StackedAreaChart`, `DoughnutChart` and the existing `CURRENCY_COLORS`. Label
   every money figure with its currency and its plane — a "net" KPI that does not
   say USD is a bug. Say on the tab that figures are Stripe-only. *Done when*
   `pnpm build` passes and the tab renders for a range with and without filters.
6. **Verify against the gateway**, §5. *Done when* every query returns the
   documented value.

## 5. What "done" looks like

All of the below is checked by `pnpm smoke:gateway-net`, which also verifies that
the view and both repo paths reproduce these numbers through the DTO.

```sql
-- fee coverage: 174,962 / 182,894 = 95.7%
SELECT COUNT(*) successful, COUNT(f.platform_payment_id) with_fee
FROM basket_payments p
LEFT JOIN basket_payment_fees f
  ON f.platform = p.platform AND f.platform_payment_id = p.platform_payment_id
WHERE p.platform = 4 AND p.status = 1 AND p.platform_payment_id IS NOT NULL;

-- the mirror agrees with our own amounts: expect 0
SELECT COUNT(*) FROM basket_payments p
JOIN basket_payment_fees f
  ON f.platform = p.platform AND f.platform_payment_id = p.platform_payment_id
WHERE p.currency = f.currency AND p.amount <> f.gross_amount;

-- settlement totals the view must reproduce
SELECT settlement_currency, ROUND(SUM(settlement_amount),2), ROUND(SUM(fee_amount),2),
       ROUND(SUM(net_amount),2)
FROM basket_payment_fees WHERE platform = 4 GROUP BY 1;

-- churn by status, not by canceled_at
SELECT status, COUNT(*) FROM basket_gateway_subscriptions WHERE platform = 4 GROUP BY 1;

-- MP must stay absent, not zero: expect 0 rows
SELECT COUNT(*) FROM basket_payment_fees WHERE platform = 0;
```

## 6. When MercadoPago lands

Flip the seam in step 2's view, rebuild, and widen the Stripe-only label. Before
that, two MP facts change the shape of any all-gateway view:

- MP settles ARS into ARS and reports no `exchange_rate`, so the planes collapse
  and cross-gateway settlement totals mix ARS with USD. Group by
  `settlement_currency` from the start and the change is additive.
- MP fee coverage will top out well below Stripe's: of 534,957 MP Pagos, only the
  391,380 with a **numeric** `platform_payment_id` can ever carry a fee. The
  143,577 `hex32` ids are preapprovals and belong to the subscriptions table.
  Bucket coverage by id shape or the number reads as broken.

Out of scope here and still unbuilt: `basket_fx_rates` (blue rate, the only path
to a single-currency revenue line) and the MP subscription fetcher.
