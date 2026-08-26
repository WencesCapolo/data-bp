# Handoff: six yearly ALLReports, then finish `/financiero`

> **Sections 1 and 2 are done — 2026-08-26.** All six files arrived, were read
> before being ingested, and went in **oldest window end first**; the two files
> already in the mirror were re-ingested afterwards so the final order is strictly
> ascending. The history now runs 2021-03-03 → 2026-08-26 from the report alone:
> 589.546 operations, 25.721 reversals worth 113.179.863,67 ARS, 460.947 rows
> carrying a `preapproval_id`. Section 2's comparison came back `fee_ratio`
> **1,0000** and zero net disagreements — the report and Cobros state the same
> figures to the cent, so **the report replaces Cobros** and the fee step is a real
> MercadoPago price change in August 2024, not a reporting artefact. The outcome is
> written up in `financiero-continue-here.md`, which is now the doc to read.
>
> Three things this section found that the plan below did not predict — all fixed,
> all in that doc's trap list: the CLI's single-file path read every file as a
> **Cobros** Export (`resolveExportSource` now decides); 20 untyped
> account-adjustment movements folded into 13,7 M ARS of invented commission
> (`isAccountAdjustment` drops them); and the mirror has **two legitimate row
> shapes**, so `smoke:gateway-net`'s global identity is now asserted per row.
>
> **Section 3 is what is left**, and 3a is blocked on the *planes de suscripción*
> Export — one real file, from a human.

Six MercadoPago *all transactions* exports are on their way to the SFTP inbox on
the box. The panel caps a report at **365 days**, so the owner generated one per
year to cover 2020-08 → 2026-08 — that is every month the dashboard has data for
(`public/dashboard.html` — gitignored, local-only — starts 2020-10-20, and 2020
is 14 rows).

The pipeline that eats them is built, tested and idempotent. **Your first job is
to ingest them in the right order, and the right order is not the order they
arrive in.** Everything after that is the last of the dashboard.

## Read first, in this order

- `docs/handoff/mercadopago-sftp-all-transactions.md` — this feed, end to end.
  Steps 1–3 are built; step 1's *"What the first FULL file taught"* is the part
  you cannot skip, because two of its three findings are about data loss.
- `docs/handoff/financiero-continue-here.md` — where the dashboard stands, and
  the decision recorded 2026-08-25 that your work here is meant to settle.
- `docs/handoff/financiero-dashboard-port.md` — the master doc: six phases, their
  `done when`, the trap list.
- `CONTEXT.md` — **Pago**, **Subscriber**, **Provider**, **Export**, **Upload**,
  **Window**, **Tier**. The schema says `gateway` where the language says
  Provider; keep `gateway` in identifiers and Provider in prose.

## The state you are inheriting

Nothing here is committed. Branch `feat/gateway-fees-and-subscriptions`, last
commit `5512a15`, and the whole of this work is in the working tree — adapter,
inbox, guards, smokes, docs. Read `git status` before you assume a file is old.

| piece | file | note |
|---|---|---|
| the adapter | `infrastructure/exports/MercadoPagoAllTransactionsExport.ts` | folds movements → one row per Pago; repairs MP's invalid CSV |
| which Export is this | `infrastructure/exports/resolveExportSource.ts` | header decides, never the filename; `READERS` is where a new Export plugs in |
| the inbox | `core/use-cases/sync/IngestExportInboxUseCase.ts` + `infrastructure/exports/FsExportInbox.ts` | already-ingested, per-file isolation, `done/`, retention |
| the guard | `DrizzleGatewayFeeRepository.upsertMany` — `NO_CHARGE` | **the reason a chargeback cannot erase a charge.** Do not remove it |
| the two checks | `core/dtos/feeTotalsCheck.ts` | invariant + ratios, shared by screen, confirm, CLI and inbox |
| the cron step | `RunSyncUseCase` step 8d, wired in `composeRunSync` | `MP_SFTP_INBOX` unset ⇒ step does not exist |
| inspect a file | `pnpm inspect:export <file...>` | window, totals, identity, reversals. Writes nothing |
| ingest | `pnpm ingest:gateway-exports <file|dir...>` | a directory argument means "inbox" |
| verification | `pnpm smoke:allreport` (24) · `pnpm smoke:gateway-net` (33) · `pnpm smoke:fee-upload` (17) | all green as of 2026-08-25 |

Two sample files already ingested into the **dev** database live in
`data/mp-allreport/` (gitignored — a Provider's ledger). Production has ingested
nothing: `MP_SFTP_INBOX` is **not set** in prod, so the cron skips the step, and
two files sit unread in `/var/lib/mp-sftp/inbox`. Enabling it is a decision the
owner has not made yet.

## 1. Ingest the six, oldest window first

**Why the order matters.** A reversal crosses a year boundary: charge in
2023-12, chargeback in 2024-01. Each file folds only what it saw.

- 2023 file first → charge row lands. 2024 file next → reversal-only fold, the
  `NO_CHARGE` guard keeps the charge and records the reversal. **Correct.**
- 2024 file first → reversal-only row lands (gross 0). 2023 file next → it has a
  charge, so it wins the whole row and writes `refunded_amount = 0`, because it
  never saw the chargeback. **The reversal is lost, silently.**

The guard protects one direction only. MP names files by generation time
(`ALLReport-manual-2026-08-25-123044.csv`), which says nothing about the window,
so arrival order is not chronological order.

**So do not drop all six in the inbox.** Read them, sort them, ingest one at a
time:

```bash
podman start data-bp-postgres-1 basket-auth-db     # both stop on their own

# 1. copy them off the box (the inbox is 0700 mpreport; the app runs as root)
SERVER=$(grep -m1 '^SERVER=' .env | cut -d= -f2-)
export SSHPASS=$(grep -m1 '^SERVER_PASS=' .env | cut -d= -f2-)
sshpass -e ssh "$SERVER" 'sudo -S -p "" ls -la /var/lib/mp-sftp/inbox' <<< "$SSHPASS"
# then, per file: sudo cp … /tmp && chown wences … ; scp it into data/mp-allreport/

# 2. read every file's window BEFORE ingesting anything
pnpm inspect:export data/mp-allreport/*.csv

# 3. ingest ascending by the window it printed, one command per file
pnpm ingest:gateway-exports data/mp-allreport/<oldest>.csv
#   … repeat, oldest → newest
```

`inspect:export` prints the window, the operation count, the totals, how many
operations describe a reversal whose charge fell outside that file, and whether
`gross − refunds − fee − tax = net` closes. A file whose identity does not close
is a file the ingest will refuse — find out here, not there.

**Watch the memory.** The adapter reads the whole file: an operation's movements
are not contiguous (in the 8-month file a chargeback sat at line 34.223 and its
settlement at 78.962), so the fold cannot stream. 73,6 MB / 118k operations read
in 7s. A heavy year may be 150–200 MB; if node dies, run it with
`NODE_OPTIONS=--max-old-space-size=8192` before rewriting anything.

**After the last file**, refresh only the view that reads fees. A full refresh
rebuilds every mat view and takes minutes:

```bash
pnpm exec tsx --env-file=.env -e "
import { DrizzleMaterializedViewRepository } from '@basket/infrastructure/db/repositories/DrizzleMaterializedViewRepository';
import { connection } from '@shared/db/client';
new DrizzleMaterializedViewRepository().refresh('basket_mat_gateway_net_daily', true)
  .then((r) => console.log('refreshed', r.durationMs, 'ms'))
  .finally(() => connection.end({ timeout: 5 }));"
```

**Done when** every file is in `done/` or accounted for by a provenance row,
`pnpm smoke:gateway-net` is green, and:

```sql
-- reversals across the whole history, not just 2026
SELECT date_trunc('year', captured_at) y, COUNT(*) ops,
       COUNT(*) FILTER (WHERE refunded_amount <> 0) reversed,
       SUM(refunded_amount)::numeric(16,2) refunded
FROM basket_payment_fees WHERE platform = 0 GROUP BY 1 ORDER BY 1;

-- no year should be missing, and no year should be all no-charge rows
SELECT date_trunc('year', captured_at) y,
       COUNT(*) FILTER (WHERE gross_amount = 0) no_charge, COUNT(*) total
FROM basket_payment_fees WHERE platform = 0 GROUP BY 1 ORDER BY 1;
```

## 2. Settle Cobros vs the report — the question these files answer

The two Exports **do not quote the same fee**, and the mirror currently holds
both: July 2024 from Cobros at 1,80% commission (withholding 5,51% recovered as
the residual), 2026 from the report at ~7,4% (commission **with IVA**, withholding
~3,4% stated). So MP's fee series steps at the boundary between which Export a
month came from — a reporting artefact, not a price change. `smoke:gateway-net`'s
band is 1–7,5% to admit it, which is a symptom, not a fix.

The 2024 window you are about to ingest contains July 2024, so for the first time
both Exports describe the same operations. Run the comparison:

```sql
-- Cobros' figures for July 2024 survive only until the 2024 report overwrites
-- them, so snapshot first, then ingest that file, then compare.
CREATE TABLE tmp_cobros_jul24 AS
SELECT platform_payment_id, gross_amount, fee_amount, tax_amount, net_amount
FROM basket_payment_fees
WHERE platform = 0 AND captured_at >= '2024-07-01' AND captured_at < '2024-08-01';

-- after ingesting the 2024 report
SELECT COUNT(*)                                             AS ops,
       ROUND(AVG(f.fee_amount / NULLIF(c.fee_amount, 0)), 4) AS fee_ratio,   -- 1.21 ⇒ IVA
       ROUND(AVG(f.tax_amount / NULLIF(c.tax_amount, 0)), 4) AS tax_ratio,
       SUM((f.net_amount <> c.net_amount)::int)              AS net_disagreements
FROM tmp_cobros_jul24 c
JOIN basket_payment_fees f
  ON f.platform = 0 AND f.platform_payment_id = c.platform_payment_id;
```

- `fee_ratio ≈ 1,21` and `net_disagreements = 0` ⇒ the report is Cobros plus IVA
  and nothing else. **The report replaces Cobros**: the whole history now comes
  from one source, the artefact disappears, tighten `smoke:gateway-net`'s band
  back to the report's real range, and say in
  `docs/handoff/financiero-continue-here.md` that the Cobros path is the
  historical importer of last resort rather than a live source.
- Anything else ⇒ they measure different things and the mirror needs to record
  **which Export a row came from** before any chart sums across the boundary.
  That is a schema change (a `source` column on `basket_payment_fees`, the way
  `basket_fx_rates.source` exists for exactly this reason — see ADR 0007) plus a
  view change. Do not paper over it with a wider ratio band.

Write the outcome into `financiero-continue-here.md` either way. The rule from
that doc stands: *do not leave the decision implied by which code exists.*

## 3. Then finish the dashboard

With the history in, three things stand between `/financiero` and done. Take them
in this order; the first is now unblocked by your own work.

### 3a. Suscripciones — the tab that still says *pendiente*

`FinancieroDashboard.tsx` renders a `no-data` panel for it and `TABS` marks it
`ready: false`. What it waits for is MP subscription **rows**:
`basket_gateway_subscriptions` holds Stripe alone, and `SUBSCRIPTION_PLATFORM` in
`DrizzleAnalyticsQueryRepository` is Stripe-only *on purpose* — widening it before
the rows exist reports MP churn as zero rather than as absent.

**Half the bridge now exists for free.** Every operation the report saw carries
its `preapproval_id` in `basket_payment_fees.subscription_id` — 94.054 of 117.710
in the 2022–2026 file, and the six yearly files will fill in the rest. So the
Pago → Subscription link is done; what is missing is the Subscription's own row
(plan, amount, status, `canceled_at`). Two ways in, and the first is cheaper:

1. The panel's **planes de suscripción** Export, behind a third
   `IPaymentExportSource`-shaped adapter and its own table. Ask the owner for one
   file first — the same discipline that saved this feed: every column name is an
   assumption until a real file exists.
2. Derive a thin subscription from the Pagos themselves (first and last charge per
   `preapproval_id`, amount, whether a charge stopped). Cheaper, and it cannot
   distinguish *cancelled* from *lapsed*, which is exactly what a churn number is
   about. Say so on the tab if you go this way.

**Done when** the tab renders without a `pendiente` badge, churn reads MP's
`status` rather than a `canceled_at` we inferred, and the seam is widened in
**both** places at once.

### 3b. Real vs Plan — blocked on a human, so ask on day one

Phase 5 needs the targets Sheet and nothing else. The ask, precisely: share the
sheet read-only with the service account that already reads the fixtures sheets,
`wenceslao@dashboards-496312.iam.gserviceaccount.com`, then

```
GOOGLE_SHEETS_ID_TARGETS=<spreadsheet id from the URL>
GOOGLE_SHEETS_TAB_TARGETS=<tab name>
```

`plan` is the **only** column the sheet owes — `real` and `prev_month_real` we
compute — and each target is stated in the Provider's own currency (MP ARS,
Stripe USD, PayPal USD) so nothing converts. Minimum columns: `month` or `date`,
`provider`, `plan`. If the owner keeps monthly rather than daily targets, say
which and spread it across the month; do not guess.

**Done when** the current month shows real, plan and previous month per Provider,
and a month with no target row renders as absent rather than zero.

### 3c. Asistente

Still last, still deferred: it needs a model and a query surface, and every number
it would quote comes from the phases above.

### Two smaller things worth closing while you are here

- **EUR has no USD figure.** dolarapi quotes ARS and Stripe leaves EUR settled in
  EUR, so `usdTotals` prints `—` for 27.742 EUR of revenue. Naming a source is
  the owner's call; `basket_fx_rates` takes one with no schema change (ADR 0007).
- **Production is not reading the inbox.** `MP_SFTP_INBOX` unset in prod, two
  files waiting. Once the history is settled in dev, setting it plus a restart of
  the `analytics` pm2 app is the whole change — and the daily reports then land on
  their own. Confirm with the owner before touching the box; it is shared with 12
  other apps (see the deploy skill).

## Traps that will cost you a day if you skip them

**`CHARGEBACK_CANCEL` is positive and is not a charge.** MP's fourth movement
type — the dispute we won. Read by sign it doubled the gross of 13 operations.
`classify()` in the adapter decides by type, substring-matched so a future
`REFUND_CANCEL` lands correctly.

**A cancel without its chargeback IS the charge.** Same amount, same commission,
same withholding as the settlement it restores. Clamping the reversal total at
zero and stopping there broke the identity by 47.586 ARS across one file.

**A window can hold a reversal without its charge.** The `NO_CHARGE` guard in
`upsertMany` is what stops such a row from erasing the charge, the commission, the
withholding, the capture date and the subscription link. With the daily schedule
this is the normal case, not an edge case. `pnpm smoke:allreport`'s second half
asserts it against a real database, twice, because a mirror that is not idempotent
is not a mirror.

**MercadoPago's CSV is invalid.** Unescaped quotes inside `METADATA` and
`TAXES_DISAGGREGATED`; a relaxed parser shifts every column after them and 205 of
332 rows silently read a withholding of zero. `repairJsonFields` handles it. Never
"fix" this by switching those columns off in the panel — `METADATA` is the only
subscription link we have.

**The identity is `gross − refunds − fee − tax = net`.** The Cobros-era version
without the reversal term misses by exactly the reversals. It lives in
`feeTotalsCheck.ts`; if you add a third Export, call that function rather than
writing the subtraction again.

**`--refresh` means two things on `ingest-gateway-exports`**: re-read files whose
name is already recorded, *and* rebuild every mat view at the end. The rebuild
takes minutes; for the gateway view alone use the snippet in section 1.

**MP's connection test leaves a file.** `CONNECTION-CHECK-FILE.csv`, 12 bytes,
re-created on every *Probar conexión*. `FsExportInbox` ignores it by name.

**The dev Postgres container has 62 MB of `/dev/shm`.** A heavy parallel query
fails with `could not resize shared memory segment … No space left on device`.
That is the container, not your query and not the disk.

**Both containers stop on their own.** Every `ECONNREFUSED` — a 500 on
`/financiero`, an `AggregateError` from a script — is `podman start
data-bp-postgres-1 basket-auth-db`, not a bug in the code you are reading.

## Verification, in order

```bash
podman start data-bp-postgres-1 basket-auth-db
pnpm inspect:export data/mp-allreport/*.csv     # windows, before ingesting
pnpm ingest:gateway-exports <file>              # oldest window first, one at a time
pnpm smoke:allreport                            # 24 checks — fold, cancels, merge guard
pnpm smoke:gateway-net                          # 33 checks — every money invariant
pnpm smoke:fee-upload                           # 17 checks — needs a live server
pnpm smoke:fx                                   # 16 checks — the FX plane
```

And the query that says whether the whole exercise achieved anything, now that it
should hold for every year and not just 2026:

```sql
SELECT COUNT(*), SUM(refunded_amount)
FROM basket_payment_fees
WHERE platform = 0 AND refunded_amount <> 0;
```

## Owed by a human, not by you

1. **The targets Sheet** (id + tab, shared with the service account). Phase 5 is
   blocked on it and nothing else; ask on day one because it has a lead time.
2. **A source for EUR/USD**, or a decision that EUR stays without a USD figure.
3. **The *planes de suscripción* Export** — one real file, before any adapter for
   it is written.
4. **Whether production starts reading the inbox** (`MP_SFTP_INBOX`), and whether
   the panel also gets a wider periodic report beside the daily one: a refund and
   its cancel only net out inside a file whose window holds both.
5. **MP's publishing IPs**, still only a hardening step for the SFTP allowlist.
