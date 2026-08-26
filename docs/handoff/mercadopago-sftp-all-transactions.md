# Handoff: MercadoPago's *all transactions* report, delivered over SFTP

MercadoPago fee data reaches us today by hand: someone downloads a monthly
**Cobros** Export from the panel and uploads it, through the screen or the CLI.
That is 27 months of files and a recurring chore forever.

MP's report centre offers a way out. It can generate a **Reporte de todas las
transacciones** (`ALLReport`) on a schedule and **push it to an SFTP server we
run**, with an optional webhook when the file is ready. This doc is how to take
that offer.

Two things make it worth doing beyond the saved clicks:

- **It sidesteps the credential block.** MP's API is unavailable to us — the
  `MP_ACCESS_TOKEN` in `.env` belongs to a test user, not to the integration, and
  has been blocked behind MP's quality measurement for weeks. SFTP delivery needs
  no API credential at all.
- **It probably carries the reversals.** The Cobros Export is `approved` only,
  which is why MP's refund column reads zero everywhere and that zero is a
  silence rather than a measurement. An all-transactions report should carry the
  refunds and chargebacks as movements of their own. **Should** — this is the
  first thing to verify, and step 1 exists to verify it.

## Read first

- `docs/handoff/mp-allreport-history-and-finish.md` — **the live continuation.**
  Six yearly exports are arriving; that doc is how to ingest them (order matters
  and the filenames do not say), how to settle Cobros vs this report, and what is
  left of the dashboard afterwards.
- `docs/handoff/financiero-continue-here.md` — where this sits. It is step 2's
  remaining half: the three feeds the Cobros Export cannot carry.
- `docs/adr/0005-gateway-fees-from-bulk-ledgers.md` — the two currency **planes**,
  and why the mirror is keyed `(platform, platform_payment_id)`.
- `docs/adr/0006-gateway-sync-rides-the-analytics-cron.md` — the cron this new
  step joins, and the never-fatal contract every step in it keeps.
- `src/modules/basket/core/ports/IPaymentExportSource.ts` — **the seam**. One
  Export, one source. A file adapter today, an API adapter the day credentials
  land. Everything below plugs in here and nothing downstream learns about SFTP.
- `src/modules/basket/infrastructure/exports/MercadoPagoCobrosExport.ts` — the
  worked example. Copy its shape, not its columns.
- `.claude/skills/deploy-data-to-portal/SKILL.md` — **read before touching the
  box.** Production is shared: 13 pm2 apps, of which this one (`analytics`) is
  one. Note the skill's own figures are stale — it says nine apps and a ~1 GB
  VPS; the box measured 2026-08-24 has 13 apps, 32 GB of RAM and 822 GB free.

## What already exists, and must be reused

| piece | file | note |
|---|---|---|
| the port | `IPaymentExportSource` | `platform`, `slug`, `origin`, `stream()` |
| the ingest | `IngestPaymentExportUseCase` | batches, flushes, returns per-file totals |
| the mirror | `DrizzleGatewayFeeRepository` | upsert on `(platform, platform_payment_id)` — re-ingest is safe |
| provenance | `DrizzlePaymentUploadRepository.record` | one row per file; **this is how "already processed" is answered** |
| CLI | `scripts/ingest-gateway-exports.ts` | takes N files, asserts the invariant per file |
| screen | `FeeUploadModal` → `/api/basket/fees/{upload,ingest}` | stays; the SFTP is a third mouth on the same pipe |
| the seam, twice | `basket_mat_gateway_net_daily` (`platform IN (0, 4)`) and `GATEWAY_PLATFORMS` in `DrizzleAnalyticsQueryRepository` | two lines in two files that must agree |

Nothing in that column needs rewriting. The work is one adapter, one directory
walker, one cron step and one hardened landing zone.

## Blocked until a human answers

*(Settled. The sample file arrived 2026-08-25 15:51Z, pushed by the panel itself
to `/var/lib/mp-sftp/inbox` — MP pushes **manually generated** reports too, not
only scheduled ones. It is kept at `data/mp-allreport/`, outside git: it is a
Provider's ledger.)*

One item remains, and it decides step 1's open question rather than blocking
anything: **an ALLReport for July 2024**, the same month the Cobros Export sample
covers. Everything below is measured against a 9-day window (2026-08-16 → 08-24,
332 movements), which is enough to build the adapter and not enough to compare the
two Exports operation by operation. See "Does this replace the Cobros Export".

The IP addresses MP publishes from are still worth asking for, and still not
blocking: the landing zone reuses port 22, which was already open to the world.

### The panel settings the report must use

| field | value | why |
|---|---|---|
| Separador | Coma | what the CSV reader already parses |
| Nombres de las columnas | Inglés | the adapter matches machine names, not translated labels |
| Contenido de las filas | **Inglés técnico** | keeps statuses as `approved` / `refunded` / `charged_back`. If this ever changes language, status classification breaks silently |
| Comprimir en `.zip` | No | nothing here unzips yet. Add it only if the files force it |
| Código de referencia de reembolso (`refund_detailed`) | **Sí** | the id a reversal is identified by |
| Movimientos de retiro (`include_withdraw`) | No, at first | withdrawals are bank movements, not transactions — one row type fewer to classify. Turn on later if payout reconciliation is wanted |
| Zona horaria | whatever it is set to — **write it down** | it currently reads GMT-04. See the clocks trap |

## Steps

### 1. The adapter — **built 2026-08-25**

`MercadoPagoAllTransactionsExport implements IPaymentExportSource`, beside the
Cobros one, registered in `resolveExportSource.ts`'s `READERS` and declared as
`mercadopago_all_transactions` in `FEE_EXPORT_SOURCES` — so it is in the Upload
screen's picker, the confirm endpoint, the CLI and the SFTP inbox at once.
Verified by `pnpm smoke:allreport` (15 checks, no database, fixture inline).

**What the file actually is.** 53 columns, UPPERCASE machine names with no
parenthesised labels at all — `TRANSACTION_DATE`, `SOURCE_ID`,
`TRANSACTION_TYPE`, `TRANSACTION_AMOUNT`, `FEE_AMOUNT`, `TAXES_AMOUNT`,
`SETTLEMENT_NET_AMOUNT`, `METADATA`, `TAX_DETAIL`, `TAXES_DISAGGREGATED`,
`EXTERNAL_REFERENCE`, `MKP_FEE_AMOUNT`, `FINANCING_FEE_AMOUNT`, plus a long tail
of POS/shipping/store columns that arrived empty on every row.

Five findings, each of which changed the code:

1. **It is not valid CSV.** MP writes JSON into `METADATA` and
   `TAXES_DISAGGREGATED` as a quoted field whose inner quotes are *not* doubled:
   `,"[{"financial_entity":"caba","amount":"-2012.50"}]",`. A strict parser dies
   at line 2 (`Invalid Closing Quote`); `relax_quotes` splits the blob at every
   comma inside it and **shifts every column after it** — measured: 205 of 332
   rows silently read a withholding of zero and an invariant that did not close.
   `repairJsonFields` doubles the quotes between `"[{` and the `}]"` that ends the
   field, before the parser sees the text. After it: 53 fields on every row and
   the invariant closes on all 332. This is the single most dangerous thing about
   the file — it fails *quietly*.
2. **The withholding is stated.** `TAXES_AMOUNT` gives it outright and
   `TRANSACTION_AMOUNT + FEE_AMOUNT + TAXES_AMOUNT = SETTLEMENT_NET_AMOUNT` held
   on all 332 rows. So this adapter does **not** derive tax as the residual the
   way migration 0015 documents as the only way — and the invariant stops being
   true by construction and becomes a real arithmetic check.
3. **The reversals are there.** `TRANSACTION_TYPE` is `SETTLEMENT` for a charge,
   `CHARGEBACK` / `REFUND` for a reversal, whose `TRANSACTION_AMOUNT` is negative
   and whose fee and withholding come back positive. The 9-day sample carried two
   reversals totalling 196.999 ARS; before it, `SUM(refunded_amount)` for MP was
   zero across 27 months and that zero was a silence.
4. **The dates carry their offset** (`2026-08-24T22:47:29.000-04:00`). No
   day-first trap here — that one belongs to the Cobros Export — and no clock to
   guess whatever the panel's *zona horaria* says.
5. **`METADATA` carries `preapproval_id`** on 205 of 332 rows: the link from a
   Pago to a MercadoPago *subscription*, which nothing else we have provides. It
   is passed through a new optional `subscriptionId` on `PaymentExportRow` and
   COALESCEd by the repository. That is why the two JSON columns were repaired
   rather than switched off in the panel.

**The fold.** One operation is several rows, the mirror is keyed `(platform,
platform_payment_id)`, so movements are folded by `SOURCE_ID` before anything is
yielded: gross sums the charges, `refundedAmount` sums the reversals, fee and tax
are summed with their signs flipped (so a returned commission cancels a charged
one), net sums as it is, `status` is `charged_back` > `refunded` > `approved` by
precedence rather than by last-writer, and `capturedAt` is the **earliest**
movement — a reversal's own date is not when the money was captured. Movements
without a `SOURCE_ID` are dropped: nothing could ever join them.

**The invariant changed shape, everywhere.** With reversals in the file, `gross −
fee − tax = net` is wrong: `net` is net of refunds while `gross` counts charges
only, so a month with one chargeback misses by exactly that chargeback. The
identity is now `gross − refunds − fee − tax = net`, in `feeTotalsCheck.ts`
(preview, confirm, CLI, inbox) and in `pnpm smoke:gateway-net`. `refundedTotal`
was added to `PaymentExportIngestResult` to make it checkable.

**Done, verified 2026-08-25:**

```
pnpm ingest:gateway-exports <inbox>   → 332 operations, file moved to done/
SELECT … WHERE platform = 0 AND captured_at >= '2026-08-01'
  n=332 gross=15.039.277,00 fee=906.867,76 tax=479.020,11 net=13.456.390,13
  refunded=196.999,00 · reversed=2 · with subscription_id=205
15.039.277 − 196.999 − 906.867,76 − 479.020,11 = 13.456.390,13   ✓ exact
pnpm smoke:allreport      15 checks green (fold, quoting, signs, precedence)
pnpm smoke:gateway-net     31 checks green (identity + "reversals are measured")
pnpm smoke:fee-upload      17 checks green (screen now goes through the registry)
```

#### What the first FULL file taught, and what it changed

The 9-day sample built the adapter; a second export covering **2026-01-01 →
08-24** (73,6 MB, 118.029 lines, 117.710 operations) is what made it correct.
Three things only volume could show:

**1. There is a fourth movement type: `CHARGEBACK_CANCEL`** — the dispute we won,
which arrives with a **positive** amount. Read by sign, it looks like a second
charge: it doubled the gross of 13 operations and left them marked charged back
while their Pago said half the money. Movements are now classified by *type*
(`classify()` in the adapter, substring-matched so a future `REFUND_CANCEL`
lands correctly), and a cancel subtracts from the reversal total instead of adding
to gross.

**2. A cancel whose chargeback fell outside the window is a re-statement of the
charge.** It carries the same amount, commission and withholding as the settlement
it restores, so whatever the cancels exceed the reversals by *is* the charge. That
is not tidiness: clamping the reversal total at zero and stopping there broke
`gross − refunds − fee − tax = net` by 47.586 ARS across the file. With the excess
moved into gross the identity is exact — 0,00 over 117.710 operations.

**3. The upsert had to learn that a window can miss the charge.** This is the one
that would have destroyed data in production, and the **daily** schedule makes it
the normal case rather than an edge case: a chargeback lands weeks after the
payment, so a day's report is mostly reversals of charges it cannot see. Such a
fold is gross 0, a negative fee (the commission coming back) and a negative net —
honest about the movements it saw, catastrophic written over the row that holds the
charge. Left unguarded, one chargeback erases that Pago's charge, commission and
withholding and reports MercadoPago as having earned nothing on it.

`DrizzleGatewayFeeRepository.upsertMany` now guards on `NO_CHARGE`
(`excluded.gross_amount = 0`): such a row updates only what it actually knows —
`refunded_amount` (monotone, so two reports each seeing one of two refunds cannot
talk each other down) and `gateway_status` (a chargeback is never downgraded, and
a window that never saw the charge cannot clear a reversal either). Everything
describing the charge, including `captured_at` and the subscription link, is kept.
`pnpm smoke:allreport`'s second half asserts all of it against a real database,
twice, because a mirror that is not idempotent is not a mirror.

**And a file of pure reversals is legitimate.** A quiet window has no charges in
it; `feeTotalsCheck` used to refuse it as `implausible_amounts` (gross ≤ 0). It now
refuses only a file with neither charges nor reversals.

**Measured after all of it** (dev database, both files ingested):

```
117.710 operations · identity off by 0,00
2026 months: fee 6,91–7,58% of gross · withholding 3,22–3,50% — flat, as expected
434 reversals · 55.602.622,10 ARS returned      ← was zero across 27 months
148 rows describe a reversal whose charge fell outside the window (gross 0)
94.054 of 117.710 operations (79,9%) carry a preapproval_id
pnpm smoke:allreport    24 checks green (fold, cancels, quoting, merge guard)
pnpm smoke:gateway-net  33 checks green
pnpm smoke:fee-upload   17 checks green
```

**Operational consequence for the panel's schedule.** Daily is fine and the guard
is what makes it safe. But a refund and its cancel, or a charge and its
chargeback, only *net out* inside one file when the window holds both — so it is
worth also scheduling a **wider periodic report** (a month, or a trailing 60 days)
whose folds are complete. Cheap insurance: re-ingesting is idempotent and the
upsert is keyed by MP's own id.

#### Does this replace the Cobros Export? Not decided — and here is the reason

**The two Exports do not quote the same fee.** Cobros' `mercadopago_fee` is the
commission alone: 1,80% of gross, with 5,51% recovered as the residual
withholding. The all-transactions report's `FEE_AMOUNT` is the commission **with
its IVA**: 6,11% measured, with 3,23% stated as withholding. Same account,
different columns, and the two are not interchangeable in one column of one
table.

That has a consequence nobody asked for: the mirror now holds July 2024 at 1,80%
and August 2026 at 6,11%, so **MP's fee series steps up at the boundary between
which Export a month came from**, not because MP raised prices. `pnpm
smoke:gateway-net`'s band was widened to 1–7,5% for exactly this reason, and that
is a symptom, not a fix.

Two ways out, and the choice needs the July 2024 ALLReport to make honestly:

- **The report replaces Cobros.** Re-import all 27 months from all-transactions
  reports, one series, reversals and subscription links throughout. Costs 27
  reports generated from the panel; leaves Cobros as dead code.
- **They coexist**, and something has to reconcile the two fee definitions — most
  simply by recording which Export a row came from and never summing across the
  boundary, which is a schema change and a view change.

Until then, **the all-transactions report is the going-forward source and Cobros
stays the historical importer**. When the July 2024 file arrives, the test is
per-operation: join the two on the payment id for that month and check whether
`FEE_AMOUNT ≈ mercadopago_fee × 1,21` and whether `TAXES_AMOUNT` reproduces the
residual. If it does, the report replaces Cobros and the 26 old months get
re-imported.

### 2. Ingest a directory, then ride the cron — **built 2026-08-25**

Done, and built adapter-agnostic on purpose: nothing in it knows the report is
MercadoPago's, so step 1's adapter joins it by adding one line to a registry.

| piece | file |
|---|---|
| the inbox, as a port | `src/modules/basket/core/ports/IExportInbox.ts` |
| the directory behind it | `src/modules/basket/infrastructure/exports/FsExportInbox.ts` |
| the step | `src/modules/basket/core/use-cases/sync/IngestExportInboxUseCase.ts` |
| which Export is this file | `src/modules/basket/infrastructure/exports/resolveExportSource.ts` |
| the two unattended checks | `src/modules/basket/core/dtos/feeTotalsCheck.ts` |
| the wiring | `composeExportInbox.ts` → `composeRunSync` → `RunSyncUseCase` step 8d |
| the CLI | `pnpm ingest:gateway-exports <dir>` — a directory argument now means an inbox |

Four decisions worth knowing, because each one is a place the obvious
implementation is wrong:

1. **The file is identified by its header, never by its name.** MP chooses the
   filename and can be reconfigured to change the file's columns without telling
   us, so `resolveExportSource` sniffs the bytes for the reader and matches the
   header's machine names against `FEE_EXPORT_SOURCES`. **This is where step 1's
   adapter plugs in**: one entry in the `READERS` map, one spec beside
   `mercadopago_cobros`, and the inbox starts accepting all-transactions reports.
   Until then the inbox reads Cobros Exports, which is what made it testable.
2. **Measure, then write.** The screen shows a human a preview before anything
   lands; the inbox has no human, so it streams the file once to tally, runs the
   invariant *and* the ratio check, and only then ingests. Reading a ~2 MB Export
   twice is the cheap half of that trade — a mirror that has already swallowed a
   moved `net` column reports a wrong cost of payments until someone re-delivers
   the file.
3. **Both checks now live in one file**, `feeTotalsCheck.ts`, and the Upload
   endpoint calls it too. There were three mouths on this pipe and only one of
   them had the ratio check.
4. **Only ingested files move to `done/`.** A file refused for its *shape* stays
   in the inbox, so the directory itself is the error report — and provenance
   keeps it from being re-read every six hours: `filenameOutcomes` reads the
   latest `basket_payment_uploads` row per name and treats a `bad_header:`-style
   error as settled. A file that *crashed* mid-ingest is not settled and is
   retried next run. `--refresh` ignores all of it.

**MP's own probe is skipped by name.** *Probar conexión* in the panel writes a
12-byte `CONNECTION-CHECK-FILE.csv` containing `test-content`, and re-writes it
every time anyone tests the connection. `FsExportInbox` ignores it: otherwise
each test would cost a `bad_header` rejection and a provenance row. Verified
2026-08-25 against the real file MP left in `/var/lib/mp-sftp/inbox`.

`done/` is pruned at `MP_SFTP_DONE_RETENTION_DAYS` (30). `MP_SFTP_INBOX` unset ⇒
the step does not exist; both are in `.env.example` and
`.env.production.example`.

**Verified 2026-08-25** against a scratch inbox holding a real Cobros Export, a
CSV with the wrong header, 2 kB of `/dev/urandom`, and a hand-made CSV whose
`net` column was moved:

```
✓ collection-…xlsx  10.056 rows, gross 75.011.659 fee 1,80% tax 5,51%  → done/
✗ moved-net.csv     implausible_amounts (retención 68,2%)  → refused BEFORE writing, left in inbox
✗ garbage.csv       bad_header       → left in inbox
✗ corrupt.bin       bad_format       → left in inbox
second run          all four skipped, no new provenance rows, fee rows +0
pnpm smoke:gateway-net   30 checks green
pnpm smoke:fee-upload    17 checks green (the endpoint refactor)
```

**The SFTP side is proven end to end as of 2026-08-25 15:03Z**: MP's panel
connected as `mpreport`, wrote into `/inbox`, and `auth.log` shows the single
session. What has not arrived yet is a report — see step 1, still the blocker.

**Still to do here**, and it needs the box rather than code: point
`MP_SFTP_INBOX` at `/var/lib/mp-sftp/inbox` in production's `.env` and restart
the `analytics` app. Nothing lands until step 1's adapter exists, so this can
wait for it — or go now, since the inbox refuses what it does not recognise.

### 3. The landing zone on the box — **built 2026-08-24**

Done. What exists now:

| | |
|---|---|
| host | the shared box (13 pm2 apps — see the blast-radius trap) |
| account | `mpreport`, uid 995, system account, `/usr/sbin/nologin` |
| jail | `/var/lib/mp-sftp` (root:root 755) |
| inbox | `/var/lib/mp-sftp/inbox` (mpreport, 0700) with `done/` beside it |
| sshd | `/etc/ssh/sshd_config.d/60-mp-sftp.conf` — `Match User mpreport`, ended by `Match all` |
| port | **22, unchanged**; no ufw rule was added |
| setup script | reproduced from this doc; it is idempotent and was removed from the server after running |

**Why port 22 and no firewall change.** The box already answers on 22 from
anywhere with `passwordauthentication yes` and `permitrootlogin yes` server-wide.
So this adds no new authentication mode and no new open port — only one more
account, and that account is jailed. When MP supplies its publishing IPs, add the
allowlist then; nothing here has to change for it.

**The two failures worth knowing about**, because both cost a round trip:

1. `tr -dc … </dev/urandom | head -c 32` under `set -o pipefail` **aborts the
   script**: `head` closes the pipe, `tr` dies of SIGPIPE, the pipeline exits
   141. It aborted *after* `useradd` had run, leaving an account with a locked
   password. `openssl rand -hex 16` has no pipeline. The rerun therefore has to
   ask "can this account log in" (`getent shadow`, field `!`/`*`/empty) rather
   than "does this account exist", or the second run leaves the account
   unusable and says nothing.
2. **The jail cannot live under `/srv`.** sshd requires every component of the
   chroot path to be root-owned, and `/srv` on this box belongs to `wences` (the
   deploy user for several apps). The symptom is not a config error: the password
   is *accepted*, then the connection is reset — `fatal: bad ownership or modes
   for chroot directory component "/srv/"` in `/var/log/auth.log`. Chowning
   `/srv` would have reached outside this feature, so the jail moved to
   `/var/lib`, which is root-owned already.

**Verified from outside the box**, in this order:

```
sftp mpreport@<host>   → connects, pwd is /, writes into /inbox      ✓
ssh  mpreport@<host>   → "This service allows sftp connections only"  ✓
sftp: get /etc/passwd  → "File not found" (the jail has no /etc)      ✓
sftp: put … /escape.txt → "Permission denied" (only /inbox is writable) ✓
ssh  <admin>@<host>    → unaffected: no chroot, no ForceCommand       ✓
pm2 list               → 13 apps still online                         ✓
```

**What the MP panel needs**, under *Servidor SFTP*:

| field | value |
|---|---|
| Servidor | the box's public IP (`SERVER` in `.env`) |
| Puerto | `22` |
| Directorio | `/inbox` — inside the jail, so this is the whole path MP sees |
| Usuario | `mpreport` |
| Contraseña | issued at setup; it lives in the password manager, not here |

Press **Probar conexión** in the panel before saving. The password can be reissued
at any time with `sudo passwd mpreport` — it is used by nothing but MP.

**Reading the inbox.** It is `0700 mpreport`, so `wences` cannot list it without
`sudo`. The analytics pm2 app runs as **root**, so the ingest step reads it
directly. If that ever changes, add a group rather than loosening the mode.

**Rollback**, if any of this has to come out:

```bash
sudo rm /etc/ssh/sshd_config.d/60-mp-sftp.conf
sudo sshd -t && sudo systemctl reload ssh
sudo userdel mpreport && sudo rm -rf /var/lib/mp-sftp
```

### 4. The webhook, optional and last

MP can call a URL when a report is generated, with an encryption password. It
buys latency — ingest on arrival instead of on the next 6-hourly sync — and costs
a public endpoint that has to authenticate MP's call. The directory scan works
without it. Do it only if the delay actually bothers someone.

## Traps

**Production is a shared box.** 13 pm2 apps, unrelated products —
`basket-app`, `clipwave`, `jarvis-bot`, `openwa`, `bp-ops-*` and others sit
beside this one. That is the blast radius of every command in step 3. Never
`systemctl restart ssh` blind: keep a second root session open, validate with
`sshd -t` before reloading, put the config in a `/etc/ssh/sshd_config.d/` drop-in
rather than editing the main file, and `reload` rather than `restart`. Locking
yourself out of that box locks nine products' operators out with you. If the
answer to "is an internet-exposed SFTP daemon on this box authorised" is anything
other than a clear yes, a separate small droplet is the cheaper conversation.

**A movement is not a Pago.** The single most likely way to get this wrong is to
stream the report's rows straight into the mirror. One operation is several rows;
the mirror holds one. Fold first — see step 1.

**A commission is not a withholding.** MercadoPago deducts both and the Cobros
Export names only the first: commission is a flat 1.80% and the net sits 7.31%
below gross. The gap is tax withheld at source, recovered as the residual, stored
in `tax_amount`. Check whether the all-transactions report states the withholding
outright — if it does, use the stated figure and stop deriving it, and say so in
a comment. Folding the two together reports MP as costing four times what it
charges.

**MercadoPago's own CSV is malformed.** Unescaped quotes inside the JSON
columns; a relaxed parser shifts every column after them and the file still looks
plausible. `repairJsonFields` in `MercadoPagoAllTransactionsExport.ts` is the
handled version — never parse this report without it, and never "fix" it by
turning the JSON columns off in the panel: `METADATA` is the only subscription
link we have.

**A reversal is not a negative charge, and a positive amount is not always a
charge.** Fold reversals into `refundedAmount`, flip the signs of the fee and
withholding that come back with them, and classify by `TRANSACTION_TYPE` rather
than by sign — `CHARGEBACK_CANCEL` is positive and is not a second charge. The
arithmetic identity is `gross − refunds − fee − tax = net`; the Cobros-era version
of it misses by exactly the reversals.

**A report window can hold a reversal without its charge.** With a daily schedule
that is the norm, not an edge case, and writing such a fold over the row that
holds the charge erases the charge. See the `NO_CHARGE` guard in
`DrizzleGatewayFeeRepository`, and never remove it without reading step 1's third
finding.

**The invariant cannot catch a moved `net` column** — *while the withholding is a
residual, which is the Cobros Export's case only.* `gross − fee − tax = net` is
zero by construction whenever tax is the residual, so a file whose `net` column
moved balances perfectly and reports MP keeping half the money. What catches that
is the **ratio** — see `implausible_amounts` in `src/app/api/basket/fees/upload/route.ts`
and `maxTaxPct` in `FeeUploadDTO.ts`. Whatever ingests these files unattended
needs the same check; an unattended path has no human to notice a suspicious
preview.

**Three clocks now, not two.** `basket_payments.created_at` is Argentina local
time stored as UTC; `basket_payment_fees.captured_at` is true UTC; and this
report is stamped in whatever the panel's *zona horaria* says — it currently
reads GMT-04. Normalise at the adapter boundary and name the offset in a comment,
the way `basket_mat_gateway_net_daily` names its clock. Anything bucketing two
tables by month misplaces transactions at month boundaries otherwise.

**Dates in MP Exports are day-first.** `31/07/2024`. `Date.parse` reads that as
month-first and silently moves every transaction before the 13th into the wrong
month. `MercadoPagoCobrosExport.parseDate` is the handled version — reuse it.

**ExcelJS streams cannot read MercadoPago's workbooks.** `WorkbookReader` fails
with `invalid signature: 0x41d` before the first row; `workbook.xlsx.readFile`
reads the same file. This report is configured as CSV, so it should not arise —
but it will the first time someone hands you an `.xlsx` by hand.

**Sniff the bytes, never the filename.** The Upload path already learned this: a
workbook saved as `.csv` is the commonest way a fee ingest goes wrong, and a
staged file has no extension at all. `sniffBinary` in
`src/shared/lib/uploadStaging.ts` is the existing check.

**The password is a credential, not config.** It goes in the MP panel and into
whatever secret store the box uses. Not in the repo, not in a doc, not echoed
into a log line. The deploy skill's warning about never echoing `$PW` applies
here for the same reason.

**`db.execute` returns timestamps as strings.** The typed generic is a claim, not
a conversion — `new Date(...)` at the mapping boundary, or `.toISOString()` throws
at runtime while typechecking clean. And bind dates as ISO strings: a `Date`
interpolated into a drizzle `sql` template fails with `The "string" argument must
be of type string`.

## Verification

Nothing here is done because it looks done. The commands, in order:

```bash
podman start data-bp-postgres-1 basket-auth-db     # both stop on their own
pnpm ingest:gateway-exports <sample-file>          # step 1
pnpm smoke:gateway-net                             # 30 checks, must stay green
pnpm smoke:fee-upload                              # 17 checks, needs a live server
```

Plus the query that says whether the whole exercise achieved anything:

```sql
SELECT COUNT(*), SUM(refunded_amount)
FROM basket_payment_fees
WHERE platform = 0 AND refunded_amount <> 0;
```

Zero there means the reversals still are not arriving, whatever else landed.
