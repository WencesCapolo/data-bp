# Handoff: turn the Sync into an ordered list of self-describing steps

Your job is to deepen `RunSyncUseCase` so that a Sync is a list of steps and one
loop, instead of a 240-line function that hand-sequences sixteen sources with
three unstated error policies. This is candidate 2 of the architecture review run
on 2026-09-07; candidate 1 (the Upload Intake) shipped as `95c0d5c` and this
handoff assumes it.

Nothing here changes what a Sync does. Same steps, same order, same watermarks,
same `RunSyncResult`. What changes is that adding a source stops being five
edits in five places, the fatality policy of each step becomes a declared fact
instead of the presence or absence of a `try`, and the ordering invariants the
comments currently plead for become something a test can assert.

## Read first

- `CONTEXT.md` — **Sync**, **Provider**, **Upload**, **Intake**. Use these words.
- `docs/adr/0006-gateway-sync-rides-the-analytics-cron.md` — the step numbering
  (7 fees, 8 subscriptions, 9 reconciliation) and why 8 is a full refresh. Do not
  re-litigate it; the step list should make it *more* visible, not less.
- `docs/adr/0001-payments-via-manual-csv-upload.md` — why scope `upload` exists.
- `docs/handoff/alert-when-a-gateway-sync-fails.md` — the outage where one throw
  at the payments step took every Provider step down with it. That outage is the
  motivating example for a declared fatality policy.
- `.claude/skills/codebase-design/SKILL.md` — module, interface, seam, adapter,
  depth. The review and this handoff use that vocabulary.
- `src/modules/basket/infrastructure/upload/PagosUploadIntake.ts` — the shape
  candidate 1 landed. `composeUploadSync` there is the one caller of scope
  `upload`; keep it working.

## What is there today

`src/modules/basket/core/use-cases/sync/RunSyncUseCase.ts`, at `95c0d5c`:

| | lines | what |
|---|---|---|
| `RunSyncDeps` | 64–130 | 33 fields: ports, child use cases, mapper functions, resource names, env-derived tunables, `scope`, all in one bag |
| `RunSyncResult` | 132–158 | 17 fields, one per step family |
| `execute` | 165–168 | dispatches on `scope` |
| `executeUpload` | 173–210 | 4 steps, then a 17-field result literal with zeros and empties |
| `reconcileAmounts` | 213–224 | step 9, catch → return 0 |
| `executeFull` | 226–467 | steps 1–10 inline; second 17-field result literal at 445–466 |

The sixteen steps of `executeFull`, with the error policy each one actually has:

| # | step | on throw | `syncState` key |
|---|---|---|---|
| 1 | tournaments | **aborts the run** | `tournaments` |
| 2 | teams | aborts | `teams` |
| 3 | users | aborts | `users` |
| 4 | payments (optional via `paymentsEnabled`) | aborts | `payments` |
| 5 | content (optional, windowed) | aborts | `content` |
| 6 | sheets, per spec | caught per spec, `-1` recorded as row count | `sheet:<name>` |
| 6b | fixture sheets, per spec | caught per spec, `-1` | `fixture:<slug>` |
| 6c | DATA-tab masters, per spec | caught per spec, `-1` | `data:<label>` |
| 7 | gateway fees | caught, `console.error`, continue | owned by the child use case (`fees:<slug>`) |
| 8 | gateway subscriptions | caught, continue | child |
| 8b | customers, disputes, payouts | caught individually, continue | child |
| 8c | FX rates | caught, continue | child |
| 8d | SFTP export inbox | caught, continue | provenance table |
| 9 | reconcile amounts | caught, returns 0 | none |
| 10 | mat-view refresh | aborts | none |

Three policies — fatal, per-item sentinel, never-fatal — and none of them is
written anywhere except as control flow. Steps 1–5 abort *after* earlier steps
have already advanced their `syncState` rows, so a run that dies at step 4
leaves `tournaments`, `teams` and `users` looking fresh and everything after
them stale. That is the exact shape of the 2026-08 outage.

Two ordering invariants live only in comments:

- 9 must run **after** 7 (`RunSyncUseCase.ts:437–439`): reconciliation reads the
  fee mirror.
- 8c must run after 7 (`:399`): the derived Stripe FX rows are read from the
  fee table.
- 8d must run before 9 (`:415`): an inbox Export may add fee rows the
  reconciliation should see.

Scope `upload` (`executeUpload`) is a hand copy of the tail: payments from the
staged file → 9 → 10. It re-declares the result shape with zeros, and any field
added to `RunSyncResult` must be added in both literals or the compiler
complains in one and the other silently drifts.

Defaults for tunables are declared twice: `composeRunSync.ts` reads the env
(`SYNC_CONTENT_WINDOW_DAYS ?? '30'`), and the use case re-defaults the same
value (`contentWindowDays ?? 30` at `:273`, `'-1month'` at `:264`).

## Callers you must not break

| caller | how it runs the Sync |
|---|---|
| `infrastructure/cron/SyncScheduler.ts:42` | `runLoggedSync(useCase, 'cron', …)` — full scope, 6-hourly |
| `app/api/basket/sync/route.ts:49` | `runLoggedSync(useCase, 'token', …)` — full scope by token |
| `infrastructure/upload/PagosUploadIntake.ts` | `composeRunSync({ paymentsCsvPath, scope: 'upload' }).execute()` — the Sync button and the CLI |
| `infrastructure/sync/runLoggedSync.ts` | writes `basket_sync_runs` from `RunSyncResult`; `DrizzleSyncRunRepository.record` reads specific fields of it |
| `scripts/run-sync.ts`, `run-live-sync.ts`, `smoke-sync.ts`, `backfill-payments.ts`, `backfill-content.ts`, `backfill-fx-rates.ts` | compose and execute, some with overrides |
| `scripts/alert-sync-stale.ts` | reads `basket_sync_state` keys, not the use case — but the **key names** in the table above are its contract |

`RunSyncResult` is read by `DrizzleSyncRunRepository.record` and rendered by the
Data Quality tab. Keep its shape; the step list produces it, it does not replace
it.

## The shape to build

Do not copy this literally. Design it, ideally twice
(`.claude/skills/codebase-design/DESIGN-IT-TWICE.md`), then pick. But the
interface the review argued for is:

- **A step** is a small object with a name, a fatality policy, and one `run`
  call that does the work and returns what it contributes to the result. The
  policy is one of the three that already exist: `fatal`, `per-item` (sheets),
  `never-fatal`. A step that owns a watermark advances it inside `run`, only on
  success — the rule ADR 0006 states for fees applies to every step.
- **The runner** is `RunSyncUseCase` reduced to: take an ordered list of steps,
  loop, apply each step's policy, fold contributions into `RunSyncResult`,
  record what failed and where. One place decides abort-versus-continue.
- **Scope** becomes a filter over the same list: `upload` is "payments from the
  staged file, reconcile, refresh". No second `execute*`, no second result
  literal.
- **Ordering** is a property of the list. The three invariants above become
  either the list's literal order plus a comment, or a declared `after:` on the
  step — the second is testable, the first is not. Prefer testable.
- **Dependencies** move out of the 33-field bag. Each step is constructed with
  what it needs in `composeRunSync`; the runner knows nothing about mappers,
  resource names or overlap days.

What must be true when you are done:

- `executeFull` and `executeUpload` are gone; `composeRunSync` builds a list.
- The three env defaults exist in exactly one place.
- A step that throws under `fatal` aborts; under `never-fatal` it is recorded
  and the run continues; under `per-item` one bad spec costs that spec only.
  Each of those is a unit test with fake steps and no database.
- A test asserts that in the `full` list, fees precede FX, fees precede
  reconciliation, the inbox precedes reconciliation, and refresh is last.
- A test asserts that the `upload` list is exactly payments → reconcile → refresh.
- `pnpm test` passes, and so do `pnpm smoke:sync` and `pnpm smoke:payments-upload`
  against a dev server — the latter proves scope `upload` still lands a file end
  to end through the Intake.

## Things that will bite you

**The partial-advance problem is a design decision, not a bug to fix silently.**
Today steps 1–3 advance `syncState` before step 4 can abort. A step list makes
it easy to change that (advance all watermarks at the end, or none on abort).
Do not change it without an ADR: `alert-sync-stale.ts` and the Data Quality tab
read those rows, and "users is fresh but payments is stale" is information an
operator currently gets. Keep the behaviour; make it declared.

**`-1` is a sentinel the Data Quality tab reads.** The sheet steps record `-1`
as row count on failure. Keep writing it until the tab stops reading it.

**Child use cases already own their watermarks.** Fees, subscriptions, the
mirrors, FX and the inbox each manage `syncState` or provenance themselves. Your
step wraps them; it does not re-implement them. Candidate 6 of the review (one
generic windowed mirror) is the follow-on that consolidates *them* — do not pull
it into this handoff.

**`composeRunSync` does async discovery** (Sheets tab listing, fixture spec
discovery from env) before it can build the list. That stays in the composer.
The runner receives a finished list.

**`runLoggedSync` catches and rethrows.** If the runner turns a fatal step into
a returned error instead of a throw, the sync log stops recording failures. Keep
fatal meaning throw, or update `runLoggedSync` and `DrizzleSyncRunRepository`
in the same commit.

**`PagosUploadIntake.ingestFile` reads `syncedPayments`, `skippedPayments`,
`correctedAmounts` and `refreshes` off the result.** The CLI prints them.

**The Intake does not go through `runLoggedSync`.** Neither did the route it
replaced, so an Upload confirm leaves a provenance row but no `basket_sync_runs`
row. Not this handoff's job, but if you touch the Intake's `composeUploadSync`
anyway, wrapping it is a one-liner and worth doing.

## Not in scope

- Candidate 3 (Population behind the analytics queries), 4 (Economía DTO),
  5 (delete the pass-through chain), 6 (one windowed mirror), 7 (Partidos).
  The review file is in the system temp dir and will not survive a reboot; the
  candidate list is in the session that produced this handoff and in the table
  below.
- Anything under `scripts/backfill-*`. They compose the Sync with overrides and
  should keep working, but they are not the deliverable.
- The MercadoPago subscription fetcher sitting uncommitted in the working tree
  (`infrastructure/gateways/MercadoPagoSubscriptionFetcher.ts` and the matching
  edit to `composeGatewayFeeSync.ts`). It belongs to the blocked-credentials
  thread. Leave it out of your commits.

For reference, the remaining candidates from the 2026-09-07 review:

| # | candidate | strength |
|---|---|---|
| 3 | one Population object behind `DrizzleAnalyticsQueryRepository` (8 mat-view forks, 5 pasted islands CTEs) | Strong |
| 4 | Economía DTO owns the month/season/fee% pivots now in `FinancieroView` | Strong |
| 5 | delete the 10 forwarding query use cases and the 13 one-adapter Repository ports | Strong |
| 6 | fold fees onto the existing generic windowed mirror; one batching loader for the four `Load*FromCsv` | Worth exploring |
| 7 | delete `partidos/lib/aggregations*.ts` (546 dead lines); merge the nacional/intl twin stacks | Strong / Worth exploring |

## Deploy

`.claude/skills/deploy-data-to-portal/SKILL.md`, invoked by the user, not by
you. No migrations are expected from this work. Production is at `95c0d5c`;
the rollback point recorded for that deploy was `532a9be`.
