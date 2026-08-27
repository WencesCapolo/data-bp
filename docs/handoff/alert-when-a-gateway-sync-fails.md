# Handoff: notify a human when the MercadoPago or Stripe sync fails

Your job is to make production **say something** when a Provider stops syncing.

> **This is not hypothetical. While scoping this handoff on 2026-08-27 the
> analytics sync was found to have failed 221 consecutive times, and nobody
> knew.** Every row in `basket_sync_state` was stale since `2026-08-10T14:45:14Z`
> — 406,8 hours. The cause is one expired credential (below). The pipeline had
> been dark for at least seventeen days on a dashboard people read daily, and the
> only trace was a line in a pm2 log file nothing watches.
>
> That is the feature request, stated as evidence. Build the thing that would
> have said so on day one.

## Read first

- `docs/handoff/ship-gateway-fees-to-prod.md` — the deploy that put all of this in
  production, and the *Not owed: `MP_ACCESS_TOKEN`* section, which you **must**
  read before you alert on a missing credential.
- `docs/adr/0006-gateway-sync-rides-the-analytics-cron.md` — why there is one cron
  and not a scheduler per Provider. That decision is what makes a single failure
  take out every downstream step.
- `.claude/skills/deploy-data-to-portal/SKILL.md` — the deploy, the sudo/ssh
  shapes, and the pnpm-not-npm install.
- `CONTEXT.md` — **Provider**, **Pago**, **Export**, **Window**. The schema says
  `gateway` where the language says Provider.

## The live failure, because it is also your test fixture

```
[SyncScheduler] sync failed: Expiró la Cookie: /payments respondió sin filas CSV
```

`BP_SESSION_COOKIE` is present in `/srv/data-bp/.env` but expired. The Control
Panel's `/payments` endpoint answers with no CSV rows, and
`RunSyncUseCase.ts:493` throws.

**That throw aborts the whole run.** The payments step sits at roughly line 193
of `execute()`; the Provider steps are far below it:

| step | line | ran on the cron since 2026-08-10? |
|---|---|---|
| users + payments | ~193 | throws here |
| gateway fees (8) | 277 | **no** |
| gateway subscriptions / mirrors | ~290–320 | **no** |
| FX rates (8c) | 338 | **no** |
| SFTP export inbox (8d) | 350 | **no** |
| amount reconciliation (9) | 378 | **no** |
| mat view refreshes | below | **no** |

Three consequences worth stating plainly, because earlier notes in `docs/` assume
the opposite:

1. **The SFTP inbox is not being walked.** MercadoPago is export-only by design,
   and the design is sound — but step 8d never executes, so the daily ALLReport
   does *not* land on its own today. MP data is as fresh as the last manual
   ingest.
2. **Step 9 is not correcting the 957 CLP amount-scale rows.** Anything that says
   "the cron will fix it" is wrong until the cookie is fixed.
3. **Stripe's incremental fee sync never runs either**, even though
   `STRIPE_SECRET_KEY` was set on 2026-08-27. The key is fine; the run dies
   upstream of it.

Fixing the cookie is **owed by a human** (below) and is not your task. But you
cannot verify an alert on a healthy pipeline you have never seen healthy, so
coordinate: get the cookie refreshed, watch one clean run, *then* break things
deliberately to test your alert.

## Where a failure actually goes today

This is the map you are working against. There are four destinations and none of
them is a notification.

| destination | what reaches it | usable? |
|---|---|---|
| `console.error` → `/root/.pm2/logs/analytics-error.log` | everything: whole-run throws *and* per-Provider failures | yes, but log-scraping and it rotates |
| `RunSyncResult` | per-Provider `error` fields, per-file inbox outcomes — the richest record | **discarded**, see below |
| `basket_sync_state` | `last_sync`, `row_count` on success only | yes, and it is queryable |
| `SyncScheduler` module state (`lastError`) | whole-run throws only | no — see below |

**`SyncScheduler` throws the result away.** `SyncScheduler.ts` does
`await useCase.execute()` and ignores the return value. Per-Provider failures are
deliberately *recorded in the result rather than thrown* so one Provider cannot
abort the others — which means on the cron path they are recorded into a value
nobody reads. `state.lastError` is set only when the entire run throws, lives in
module memory, and is lost on every restart.

**`basket_sync_state` has no room for a failure.** The whole table is:

```
source      text primary key
last_sync   timestamptz not null
row_count   integer
```

No status, no error, no attempt count. A Provider that failed looks exactly like
a Provider nobody has configured — both are simply absent or stale. **This is the
schema gap, and closing it is the most valuable thing you can do here.**

**`GET /api/basket/sync` already answers, and answers to anyone.** It returns
every watermark, plus `inFlight`, `lastError` and `lastResult`. Two things about
it:

- It is **200 unauthenticated.** `src/proxy.ts` early-returns for
  `/api/basket/sync` so the token-authenticated automation can POST to it, but
  only `POST` checks `x-sync-token` — `GET` checks nothing. Convenient for a
  poller; also a metadata leak (row counts and sync times, no amounts) that
  somebody should decide about deliberately rather than inherit by accident.
- `lastError` and `lastResult` on it are the same doomed module state: populated
  by the manual POST path only, never by the cron.

**There is no outbound notification code in this repo at all.** Grep for
`notify|alert|webhook|slack|smtp` and every hit is a CSS class or an `ErrorBox`
component. You are adding the first one.

## What to build

### 1. Persist the run, then alert off the database

Do not build an alerter that scrapes pm2 logs. It will work, and it will rot the
first time the log rotates or a message is reworded.

Give `basket_sync_state` (or a new `basket_sync_runs` table, which is probably
cleaner — one row per run, not per source) somewhere to record: the run's start
and finish, whether each Provider step succeeded, its error string, and whether
the step was **skipped** versus **failed**. Then have `SyncScheduler` write the
`RunSyncResult` it currently discards.

That single change turns every question below into SQL, makes the failure visible
on the dashboard as well as in a notification, and gives you something to test
against without provoking a real outage.

### 2. Alert on these

Thresholds assume the production cron `0 */6 * * *` (`SYNC_INTERVAL_HOURS`,
default 6). Two missed cycles plus margin ≈ **13 hours**.

| condition | why it matters |
|---|---|
| whole run threw | today's actual failure; everything downstream is dark |
| `fees:stripe` watermark older than 13h | Stripe fees stopped; Economía silently freezes |
| MP fee data older than ~26h | the daily ALLReport did not land; use inbox file age, see below |
| newest file in `MP_SFTP_INBOX` older than 26h | MP's publishing pipeline stopped. **Nothing else watches this**, and it is the only liveness signal MercadoPago has now that it is export-only |
| a Provider step recorded an `error` | per-Provider failure the run swallowed to protect the others |
| an inbox file whose `outcome` is neither ingested nor `skipped` | a file arrived and could not be read |
| `basket_payment_uploads` gap, or fee coverage falling below its band | slow rot rather than a hard stop |

Include in the message: which Provider, the error string, how long it has been
failing, and the last known-good time. "Stripe sync failed" without "since 06:00,
4 cycles" makes someone go read logs anyway.

### 3. Do **not** alert on these

This is the half that makes the alert trustworthy. A notifier that cries wolf
gets muted, and then you have built nothing.

- **`MP_ACCESS_TOKEN not set` is correct and permanent.** The log says
  `[sync] gateway mercadopago skipped: MP_ACCESS_TOKEN not set` on every run and
  it is *wanted* — MercadoPago is export-only, the API cannot report `tax_amount`
  or `subscription_id`, and setting the token would erase withholding. Read the
  *Not owed* section of the ship handoff. **Skipped is not failed**, and your
  schema must distinguish them or you will page someone forever.
- **`GOOGLE_SHEETS_ID_TARGETS` absent.** Real vs Plan ships *en desarrollo*.
- **Stripe returning nothing for a quiet window.** A skipped step and a step that
  found zero rows look identical from outside; only the recorded outcome tells
  them apart.
- **Sheet and fixture failures.** These already `console.error` per sheet and are
  caught individually. In scope only if the owner asks.

### 4. Pick a transport with the owner

Nothing in this repo sends anything, and the choice is not yours to make alone.
What the box already runs, all `online` under pm2 as of 2026-08-27: `openwa`
(WhatsApp), `jarvis-bot`, `bp-atencion`, `basket-clip-bot`. Those belong to other
products — **do not wire into them without asking.** The box carries 13 pm2 apps
and 12 nginx vhosts, and that is the blast radius.

Whatever you choose, the alert must not depend on the analytics app being healthy
to fire. An in-process notifier inside `analytics` cannot report that `analytics`
is down.

## Done when

- A clean run has been observed, and the run result is persisted where SQL can
  reach it.
- `MP_ACCESS_TOKEN not set` has run through your logic and produced **no** alert.
- You have deliberately broken one Provider — a bad `STRIPE_SECRET_KEY` is the
  cheap way — and a human received a notification naming Stripe, the error, and
  the duration.
- You have restored it, and a recovery is visible too. An alert with no "it is
  back" leaves people watching logs.
- The inbox-age check has been tested by moving the newest inbox file aside.

## Traps

**Skipped is not failed.** The single most likely way this feature becomes noise.

**Per-Provider failures never throw.** By design. If you only catch exceptions,
you will catch today's cookie failure and miss every Stripe-specific one.

**The run dies before the Provider steps.** So during the current outage a
per-Provider alerter would report nothing at all and look healthy. Alert on the
*run*, not only on its parts.

**`SyncScheduler` state is per-process.** Every deploy restarts `analytics` and
clears `lastError`. Do not build on it.

**`sudo pm2` for everything on that box**, including read-only calls — an
unprivileged `pm2` talks to a different, empty daemon.

**Never `echo "$PW" | sudo -S`.** It puts the server password in that box's
process table where any user can read it with `ps`. Use the herestring form
`sudo -S -p '' cmd <<<"$PW"` from the deploy skill. This was done during the
2026-08-27 deploy and the credential needed rotating.

**Prod's `DATABASE_URL` is `localhost` too** — byte-identical to the local one,
different database. `scripts/apply-sql.ts` prints which database it reached
before writing; `scripts/_q.ts "<sql>"` is the read-only companion. There is no
psql on that box.

## Owed by a human, not by you

1. **A fresh `BP_SESSION_COOKIE`** in `/srv/data-bp/.env`, then
   `sudo pm2 restart analytics --update-env`. Nothing in the pipeline runs until
   this happens, and it will expire again — which is an argument for alerting on
   it specifically, and possibly for a real credential instead of a session
   cookie.
2. **The transport decision** in section 4, and who should receive it.
3. **Whether `GET /api/basket/sync` should stay public.** It is a metadata leak
   inherited by accident, not a decision anyone made.
4. **Whether the panel sends a wider periodic report** beside the daily ALLReport.
   A daily file cannot hold a chargeback raised three weeks after the charge, and
   no alert can compensate for data that was never published.
