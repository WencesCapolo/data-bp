# Handoff: MercadoPago gateway sync

**Goal.** Bring MercadoPago to the same place Stripe now is: per-transaction fees
and net in `basket_payment_fees`, subscriptions in `basket_gateway_subscriptions`,
both running as delta steps inside the normal analytics sync.

The Stripe half is done and merged. The MercadoPago fee fetcher is **written and
unit-verified but has never run against the live API**, because no credential
existed. Everything below is either wiring that already exists and needs
switching on, or the one piece that genuinely has to be built.

---

## 0. Read these first

- `docs/adr/0005-gateway-fees-from-bulk-ledgers.md` — why bulk ledger reads, why
  the table is keyed by `(platform, platform_payment_id)`, the two currency planes.
- `docs/adr/0006-gateway-sync-rides-the-analytics-cron.md` — how the sync steps
  are ordered and why subscriptions cannot be a delta.

The two-currency-plane rule in ADR 0005 is the one thing not to get wrong.
*Presentment* (`currency`, `gross_amount`) is what the subscriber was charged and
reconciles against `basket_payments.amount`. *Settlement* (`settlement_*`,
`fee_amount`, `net_amount`) is what the gateway moved. Fees exist only in the
settlement plane. Do not convert between them, and do not invent a USD figure —
ARS→USD is a separate, still-unbuilt concern with its own source (the blue-rate
table).

---

## 1. Get the credential

`MP_ACCESS_TOKEN`, from mercadopago.com.ar/developers/panel → **Tus
integraciones** → the app → **Credenciales de producción** → Access Token
(`APP_USR-…`).

Two failure modes that do not raise errors:

- A **test** credential (`TEST-…`) returns only sandbox payments — a clean,
  empty, wrong run.
- A token from an account that is **not the collector** returns
  `fee_details: []` for every payment, so all commissions read `0.00` and nothing
  complains.

`pnpm smoke:fees --only=mercadopago` catches both. Expect `fee/gross` in roughly
**2–10%**. `0.00%` means wrong account.

> Note: `.env.example` is **gitignored** in this repo (the `.gitignore` `.env*`
> pattern matches it), so the variable documentation lives only in local copies
> and here. Env vars in play: `MP_ACCESS_TOKEN`, `SYNC_GATEWAYS_ENABLED`,
> `SYNC_GATEWAY_FEE_OVERLAP_DAYS` (default 14), `SYNC_GATEWAY_FEE_WINDOW_DAYS`
> (default 7).

---

## 2. Fees — already built, needs validating against the live API

`src/modules/basket/infrastructure/gateways/MercadoPagoFeeFetcher.ts` is complete
and already wired into `composeGatewayFeeSync()`. Setting the token is enough for
it to start running in the sync.

What it does, and the two decisions worth knowing:

- Reads `/v1/payments/search` by time window, 100 per page, instead of 273k
  per-id lookups (~2.8k requests total).
- **MercadoPago refuses `offset + limit > 1000`** with no cursor available, so any
  window returning more than 1000 payments is recursively halved. At ~340
  payments/day this never triggers. If a single second ever exceeds 1000, rows
  past 1000 are unreachable by any query MercadoPago offers and the run says so
  loudly via `onWindowOverflow` rather than reporting success.
- Only `fee_payer === 'collector'` fees are counted. `fee_details` also lists
  fees charged to the payer (instalment financing), which the subscriber pays on
  top and which never leaves our balance.

**Verify before trusting it.** These paths have only ever run against stubbed
responses:

1. `pnpm smoke:fees --only=mercadopago` — check the sample rows and the ratio.
2. Confirm `fee_details[].fee_payer` and `transaction_details.net_received_amount`
   are actually populated on real rows. The fetcher falls back to
   `gross - net_received_amount` when `fee_details` is empty; if *both* are empty
   in production, every fee silently becomes 0 and that fallback needs rethinking.
3. Confirm the `begin_date` / `end_date` format is accepted. The fetcher sends
   `2026-06-04T23:59:59.999-00:00` (millisecond precision, explicit offset,
   end-inclusive minus 1ms since our windows are half-open).
4. Run one small window and check the join rate against `basket_payments`.

Then backfill:

```bash
pnpm backfill:fees -- --only=mercadopago --from=2024-05-21
```

`--from=2024-05-21` is one day before the first Pago on purpose — see §5 on the
timezone skew. Expect ~273k transactions. Stripe's 183k took ~88 minutes, so
budget a couple of hours and run it detached. It is re-runnable: rows upsert by
`(platform, platform_payment_id)`, and only a clean run advances the
`fees:mercadopago` watermark.

**Expected coverage.** Measure against successful Pagos carrying a *numeric* MP
id. The 496+ `hex32` ids are preapproval authorizations, not payments — they have
no fee and never will, exactly like Stripe's `sub_` rows.

---

## 3. Subscriptions — the part that must actually be built

`basket_gateway_subscriptions` currently holds Stripe only. MercadoPago
subscriptions are **preapprovals**, and there is no fetcher for them.

Build `MercadoPagoSubscriptionFetcher implements IGatewaySubscriptionFetcher`
(port at `src/modules/basket/core/ports/IGatewaySubscriptionFetcher.ts`), then add
it to the `subFetchers` array in `composeGatewayFeeSync.ts`. The use case,
repository, table and sync step all already exist and are gateway-agnostic.

Source: `GET /preapproval/search`. Map onto `GatewaySubscriptionProps`:

| target | source |
|---|---|
| `subscriptionId` | `id` (the hex32 that already appears in `basket_payments.platform_payment_id`) |
| `status` | `status` — `authorized`, `paused`, `cancelled`, `pending` |
| `amount` / `currency` | `auto_recurring.transaction_amount` / `.currency_id` |
| `interval` / `intervalCount` | `auto_recurring.frequency_type` / `.frequency` |
| `createdAt` | `date_created` |
| `currentPeriodStart/End` | `auto_recurring.start_date` / `.end_date` |
| `canceledAt` | not exposed directly — see below |

Two things to decide, neither of which has an obviously right answer:

- **`cancelAtPeriodEnd` and `canceledAt` may have no MercadoPago equivalent.**
  Preapprovals go straight to `cancelled` without recording *when*. If so, set
  `cancelAtPeriodEnd: false` and derive nothing — leave `canceledAt` null rather
  than substituting `last_modified`, which is a different fact. Then make sure
  whatever churn view gets built reads `status` for MP rather than `canceledAt`,
  or MP churn silently disappears from the chart.
- **Status vocabulary differs from Stripe's** (`authorized` vs `active`,
  `cancelled` vs `canceled` — note the spelling). Either normalise on write or
  handle both in the views. Normalising loses the gateway's own word, which
  everywhere else in this codebase is kept verbatim; I lean toward keeping it raw
  and mapping in the view, consistent with `gateway_status`.

Also worth doing while there: MP preapprovals are the missing link for
`basket_payment_fees.subscription_id`, which is null for every MP row today. A
payment does not carry its preapproval id, so the link needs the preapproval's
payment list, or matching by payer + amount + schedule. **Do not guess it from
timing and amount** — that is a heuristic that will silently mis-attribute
renewals. If it cannot be resolved exactly, leaving it null is the honest outcome
and is what the column does today.

---

## 4. What "done" looks like

```sql
-- fee coverage: should be ~100% of numeric-id successful Pagos
SELECT p.platform, COUNT(*) joinable, COUNT(f.platform_payment_id) with_fee
FROM basket_payments p
LEFT JOIN basket_payment_fees f
  ON f.platform = p.platform AND f.platform_payment_id = p.platform_payment_id
WHERE p.status = 1 AND p.platform_payment_id IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- the mirror must agree with the gateway on money
SELECT COUNT(*) FROM basket_payments p
JOIN basket_payment_fees f
  ON f.platform = p.platform AND f.platform_payment_id = p.platform_payment_id
WHERE p.currency = f.currency AND p.amount <> f.gross_amount;   -- expect 0

-- MP preapprovals resolve, once §3 is built
SELECT COUNT(*) total, COUNT(s.subscription_id) resolved
FROM basket_payments p
LEFT JOIN basket_gateway_subscriptions s
  ON s.platform = p.platform AND s.subscription_id = p.platform_payment_id
WHERE p.platform = 0 AND p.platform_payment_id ~ '^[0-9a-f]{32}$';
```

`pnpm backfill:fees` prints the coverage table itself at the end.

---

## 5. Traps that cost time here

- **`basket_payments.created_at` is Argentina local time stored as if it were
  UTC**; `basket_payment_fees.captured_at` is true UTC. A 3-hour skew. It does not
  affect joins (those go by gateway id) but it *will* misplace transactions near
  month boundaries in any view that buckets across both tables. Unresolved —
  whoever builds the finance view must handle it explicitly.
- **The CLP ×100 export bug.** `ReconcilePaymentAmountsUseCase` runs as sync step
  9 and realigns amounts to the gateway. It is a workaround for a defect in the
  Control Panel export and only covers rows that *have* a fee row — so MP rows are
  uncorrected until MP fees land. Worth re-running `pnpm fix:amounts` after the MP
  backfill to see whether MP has the same problem.
- **Coverage percentages move when Pagos are ingested**, not only when fees are.
  A drop usually means new Pagos arrived, not that fees were lost. Bucket the
  uncovered rows before investigating.
- **Never `git add -A` in this repo.** The working tree carries customer CSV
  exports with emails and names, `.xlsx` files, and a 12.9MB `public/dashboard.html`
  with embedded customer data — all untracked and none of it gitignored.

---

## 6. Still open beyond MercadoPago

- `basket_fx_rates` (blue rate) — nothing converts ARS to USD yet, so no USD
  revenue line exists. MercadoPago reports no exchange rate at all; Stripe reports
  its own per balance transaction.
- The finance materialized view and the dashboard tab that consumes all of this.
- PayPal fees are **not obtainable**: those Pagos carry internal `upgrd_*` ids
  rather than PayPal transaction ids. Not a gap to close.
