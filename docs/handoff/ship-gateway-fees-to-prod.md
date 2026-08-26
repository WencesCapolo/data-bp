# Handoff: ship the fee mirror, the FX plane and the SFTP inbox to prod

Everything below is **built, ingested and green in dev**. None of it is in
production, and none of it is even committed. Your job is the deploy, in an
order where each step is verifiable, and the first half of that job is git
hygiene rather than anything clever.

The owner has already decided the two things that needed deciding: **production
should read the SFTP inbox** (`MP_SFTP_INBOX`), and **Real vs Plan ships as a tab
marked *en desarrollo*** rather than waiting for the targets Sheet.

## Read first

- `docs/handoff/financiero-continue-here.md` — where the dashboard stands, the
  settled Cobros-vs-report decision, and the trap list this work added to it.
- `docs/handoff/mp-allreport-history-and-finish.md` — its banner records what the
  six yearly exports did. Sections 1 and 2 are done; do not re-run them.
- `.claude/skills/deploy-data-to-portal/SKILL.md` — **the deploy itself.** Seven
  steps, a rollback, and the sudo/prelude shapes that make ssh to that box work.
  This handoff does not restate it; it tells you what to do *around* it.
- `CONTEXT.md` — **Pago**, **Provider**, **Export**, **Upload**, **Window**. The
  schema says `gateway` where the language says Provider.

## The state you are inheriting

Branch `feat/gateway-fees-and-subscriptions`, last commit `5512a15`, and **~100
changed paths are uncommitted**. Read `git status` before assuming anything is
old. Verified in dev on 2026-08-26:

```
tsc --noEmit          clean
pnpm smoke:allreport   24 ✓
pnpm smoke:gateway-net 33 ✓
pnpm smoke:fx          20 ✓
pnpm smoke:fee-upload  17 ✓   (needs a dev server up)
```

`pnpm lint` fails with 5 errors. **All five pre-date this work** — `Header.tsx`,
`layout.tsx`, `LandingHeader.tsx`, `smoke-sync.ts`, `probe-data-tabs.ts`. Nothing
in this branch is in that list. Do not fix them inside this deploy; a lint sweep
across files you are not shipping is how a deploy stops being reviewable.

### What production actually is right now

| | |
|---|---|
| checkout | `/srv/data-bp`, **`main` @ `156f55d`**, root-owned |
| pm2 app | `analytics` (port 3001), runs as root, 13 apps share the box |
| migrations applied | **up to `0011`** |
| `src/modules/basket/infrastructure/exports/` | **does not exist** |
| `MP_SFTP_INBOX` | unset |
| `STRIPE_SECRET_KEY` | **not in prod `.env` at all** |
| the inbox | `/var/lib/mp-sftp/inbox`, `0700 mpreport`, **10 files unread** |

**This is why `MP_SFTP_INBOX` was not simply set.** It gates `RunSyncUseCase`
step 8d, which is not in the deployed build. Setting it today puts a variable in
`.env` that switches on a step that does not exist — a change that looks done and
does nothing. The flag goes in at step 5 below, after the code that reads it.

## 1. Clean the tree before you stage anything

`git status` is carrying files that must not ship. This is the step that costs
you a day if you skip it, and one of them is a genuine leak.

**`public/dashboard.html` is 13,9 MB of real revenue figures in a public
directory.** Next serves `public/` unauthenticated, so committing it as-is
publishes the prototype at `https://analytics.basket-app.com/dashboard.html` —
no SSO in front of it, because SSO protects routes and this is a static asset.
Every handoff in `docs/` cites it by that path, so it cannot simply be deleted
either. Pick one and say which in the commit:

- move it to `docs/prototype/dashboard.html` and update the four handoffs' path
  references — the honest option, and the references are a `grep -rl` away;
- or gitignore it and keep it local, accepting that the docs point at a file a
  fresh clone will not have.

Do **not** commit it under `public/`.

The rest is unambiguous junk — one-off exports someone left in the working tree:

```
payments20260804223735.csv
reporte_ligas_20260803.csv           reporte_ligas_adc.csv
subscriptions20260730143142.csv      subscriptions20260803144655.csv
public/judicializaciones-2026-08-1{1,2}*.xlsx
public/juicios-por-provincia-2026-08-1{1,2}*.xlsx
```

Gitignore or delete them. `data/mp-allreport/` is already gitignored and stays
that way — it is a Provider's ledger.

**Done when** `git status --short` shows only files you intend to ship, and
`grep -rl "public/dashboard.html" docs/` returns either nothing or the four files
you just updated.

## 2. Commit and merge

The branch is one coherent change — fee mirror, FX plane, SFTP inbox, the six
yearly exports' findings, the dashboard tab. Split it into commits somebody can
review; do not squash 100 paths into one.

Then `main`, and push. **The deploy skill only pulls `main`** — a deploy from a
feature branch is a state that exists nowhere else.

**Done when** `git log --oneline origin/main -1` is the sha you are about to
deploy, and you have written it down.

## 3. Migrations — the gate, and it is a real one

Step 2 of the deploy skill stops here and asks. The answer is **yes, seven files,
plus a rebuilt `0001_views.sql`**:

| file | what it adds |
|---|---|
| `0008_contactos` | contactos directory (unrelated to this work, but pending) |
| `0012_gateway_fees` | the fee mirror |
| `0013_gateway_subscriptions` | Stripe subscription rows + linkage |
| `0014_stripe_customers_disputes_payouts` | the three Stripe Exports |
| `0015_fee_tax_amount` | withholding as its own column |
| `0016_users_lower_email_idx` | `LOWER(email)` functional index |
| `0017_fx_rates` | the FX plane |

**Every one is idempotent** — `CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT
EXISTS` — so a re-run is safe and a half-finished run is recoverable. That is the
one thing making this gate tolerable.

Three things the skill's wording does not yet know:

**`0001_views.sql` now rebuilds six mat views, not five.** The skill says five;
`basket_mat_gateway_net_daily` is new. `npm run views:apply` **drops them all
before rebuilding**, so every tab reading a mat view errors for the duration
(~190s in dev, longer in prod). Run it in a low-traffic window and expect the
dashboard to be down, not slow, while it runs.

**`0016` is `CREATE INDEX`, not `CREATE INDEX CONCURRENTLY`.** It takes an
`ACCESS EXCLUSIVE`-adjacent write lock on `basket_users` — 262.372 rows in dev —
for the length of the build. The sync writes to that table. Either run it while
the cron is idle, or rewrite it as `CONCURRENTLY` first (it cannot run inside a
transaction if you do).

**There is no `psql` on that box.** Everything except `0001_views.sql` needs a
tsx one-off, and the script has to sit inside `/srv/data-bp` to resolve
`node_modules`. The prod database is that box's own local Postgres — the
connection string is byte-identical to the one in your `.env` and points at a
different database. Read that sentence twice before pasting a command.

**Done when** every migration has been applied once and `\d basket_fx_rates`
answers on the prod database, and the six mat views report non-zero rows.

## 4. Deploy

Follow `deploy-data-to-portal` steps 1 and 3–7 as written — rollback sha first,
`git pull --ff-only` as root, build and **check `BUILD_EXIT=0`** rather than
reading the route table, restart `analytics` **only**, then its four smoke checks.
The box carries 13 pm2 apps and 12 nginx vhosts; two of those smoke checks exist
purely to prove the blast radius stayed contained.

## 5. The environment, after the code and not before

Add to `/srv/data-bp/.env`, then `sudo pm2 restart analytics --update-env`:

```
MP_SFTP_INBOX=/var/lib/mp-sftp/inbox
```

The owner has approved this one. Step 8d then walks the inbox on the analytics
cron, and the daily reports land on their own. The app runs as root, so the
inbox being `0700 mpreport` is not in its way.

Two more the owner has not supplied, and neither blocks the deploy — both feeds
gate cleanly on an absent variable and report themselves as skipped rather than
throwing:

- `STRIPE_SECRET_KEY` — **absent in prod**, so the Stripe fee and subscription
  steps will skip silently on every run. Worth saying out loud in your report,
  because a skipped step and a step that found nothing look identical on the tab.
  Note the local `.env` holds a masked key, so this path has never run against a
  live Stripe from anywhere.
- `GOOGLE_SHEETS_ID_TARGETS` / `GOOGLE_SHEETS_TAB_TARGETS` — Real vs Plan. The
  tab ships marked *en desarrollo* and names both variables on its own panel, so
  shipping without them is the intended state, not a regression.

**Done when** `sudo pm2 jlist` shows `MP_SFTP_INBOX` set on the `analytics`
entry — not merely present in `.env`, which is not the same thing without
`--update-env`.

## 6. Backfill prod, oldest window end first

Production has ingested **nothing**. Ten files wait in the inbox: six yearly
manual ALLReports and four dailies.

**Do not drop them all in and let the cron take them.** MP names files by
generation time, which says nothing about the window, so arrival order is not
chronological order — and the merge guard only protects one direction. A 2023
file ingested *after* a 2026 one wins the whole row for any operation it saw the
charge for, and writes `refunded_amount = 0` because it never saw the 2026
chargeback. The reversal is lost silently.

Two further things `inspect:export` will show you and the filename will not:

- **A file's printed window start is a lie.** Each file's earliest date comes
  from a reversal whose charge predates the report. Sort by the **window end**.
  In dev the correct order was `133137 · 145011 · 202156 · 213621 · 222711 ·
  233413`, then the newest-window files, then the dailies.
- **`233413` is a superset of `123044`** — same end date, 28 months against 22.
  Ingest the subset first.

```bash
pnpm inspect:export <files...>        # windows and totals, writes nothing
pnpm ingest:gateway-exports <file>    # one command per file, ascending by window END
pnpm backfill:fx --since=2023-10-01   # blue history + the EUR cross
```

Watch the memory: the adapter cannot stream, and a heavy year is 150–200 MB.
`NODE_OPTIONS=--max-old-space-size=8192` before rewriting anything.

Then refresh the one view that reads fees rather than rebuilding all six — the
snippet is in `mp-allreport-history-and-finish.md` section 1.

**Done when** every file is in `done/` or has a row in `basket_payment_uploads`,
and on the prod database:

```sql
-- every year present, none of them all-no-charge
SELECT date_trunc('year', captured_at) y, COUNT(*) ops,
       COUNT(*) FILTER (WHERE gross_amount = 0) no_charge,
       COUNT(*) FILTER (WHERE refunded_amount <> 0) reversed
FROM basket_payment_fees WHERE platform = 0 GROUP BY 1 ORDER BY 1;
```

Dev's answer, for comparison: 2021 → 2026, **589.546 operations, 25.721
reversals worth 113.179.863,67 ARS**, 460.947 rows carrying a `preapproval_id`.

## Traps that will cost you a day

**The dashboard prototype is a public asset.** See step 1. It is the only item
here that is worse to get wrong than to get slow.

**`MP_SFTP_INBOX` before the code is a no-op that reads as done.** The whole
reason this handoff exists in this order.

**`views:apply` is downtime, not latency.** It drops six mat views before
rebuilding. Every tab reading one errors until it finishes.

**Prod's `DATABASE_URL` is `localhost` too.** Identical string, different
database, different box. A tsx one-off run from your machine hits *your*
Postgres and reports success.

**A build that failed still prints a route table.** Judge it by `BUILD_EXIT`,
and redirect the log to a path you own — `sudo cmd > /root/...` is your shell
writing, not sudo's, so it fails while `tail` shows the previous deploy's output.

**`pm2` unprivileged talks to an empty daemon.** Everything on that box is
`sudo pm2`, including the read-only calls.

**Both dev containers stop on their own.** Every `ECONNREFUSED` locally is
`podman start data-bp-postgres-1 basket-auth-db`.

**The fee mirror has two legitimate row shapes**, and a global `SUM` cannot tell
them apart. If `smoke:gateway-net` fails on the MP identity after the prod
backfill, read that check's comment before touching a tolerance — 238 rows
missing the identity by exactly their own `refunded_amount` is the merge guard
working, not a bug.

## Owed by a human, not by you

1. **The *planes de suscripción* Export** — one real file. It is the only thing
   between the Suscripciones tab and done; the Pago → Subscription bridge is
   already built and populated.
2. **The targets Sheet** (id + tab), shared read-only with
   `wenceslao@dashboards-496312.iam.gserviceaccount.com`. Real vs Plan ships
   *en desarrollo* until it arrives.
3. **A prod `STRIPE_SECRET_KEY`**, or a decision that Stripe stays unsynced there.
4. **Whether the panel also sends a wider periodic report** beside the daily one.
   A refund and its cancel only net out inside a file whose window holds both, and
   a daily file cannot hold a chargeback raised three weeks after the charge.
5. **MP's publishing IPs**, still only a hardening step for the SFTP allowlist.
