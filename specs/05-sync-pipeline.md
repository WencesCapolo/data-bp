# 05 · Sync Pipeline

Entry points:
- `POST /api/basket/sync` (guarded by `x-sync-token` header matching env `SYNC_TOKEN`)
- `node-cron` schedule (every `SYNC_INTERVAL_HOURS`, default 6) registered in `SyncScheduler`
- `pnpm smoke:sync` (one-off manual run)

All converge on `composeRunSync()` → `new RunSyncUseCase(deps).execute()`.

The Sync button (`POST /api/sync`, Upload required) runs with `scope: 'upload'`: the
Pagos step from the file, the amount realignment, and the mat-view refresh — nothing
else. Every other source is the cron's job, and the Provider steps alone take ten-plus
minutes against Stripe. `SYNC_PAYMENTS_ENABLED=false` only stops the full run from
calling the dead `/payments` endpoint; it never gates an Upload.

## Stage order (RunSyncUseCase)

```
1. Tournaments        (no FK deps)
2. Teams              (live: id/name/country only; preserves curated league/tier/type)
3. Users              (depend on known team_ids → unknown promo_team_id NULL’d)
4. Payments           (depend on known user_ids; optional, off if SYNC_PAYMENTS_ENABLED=false)
5. Content            (windowed: from = now - SYNC_CONTENT_WINDOW_DAYS, to = now)
6a. Generic Sheets    (incidents + grilla_<month>) → basket_sheet_rows
6b. Fixture Sheets    (per league) → basket_fixture_matches
6c. DATA-tab masters  (per workbook) → basket_team_master + cambios_enum + dias_enum
7. Refresh mat views  CONCURRENTLY
```

Stages 1–5 abort whole run on failure (FK dependents). Stages 6a–6c **isolated**: a failing sheet logs + reports `inserted: -1`, others continue.

## Idempotency

Every stage uses Drizzle `.onConflictDoUpdate({ target: ..., set: ... })` with `target` = PK.
- Re-running same data → 0 row delta.
- `basket_sync_state` updated **only on stage success** (after the batch resolves).

Batched at 500 rows for upserts. Streaming for CSV reads (avoids buffering full payload).

## Active-window grace

Active on date D iff:
```sql
status = 1
AND created_at::date <= D
AND (expires_at + INTERVAL '7 days')::date >= D
```
7-day grace accommodates payment-processing delays + brief lapses before renewal.

## Teams partial-merge rule

Live `/teams` CSV provides `id, name, country` only. Local DB also stores `league, tier, type` (curated, hand-maintained).

`DrizzleTeamRepository.upsertManyFromLive`:
- **Insert (new id)**: `league='Unknown', tier=1, type='regular'`.
- **Update (existing id)**: update **only** `team_name + country`. Preserve curated.

Trade-off: `basket_teams.league` nullable (migration 0002 dropped NOT NULL) since live API can introduce ids before a curator adds metadata.

## Users partial-NULL rule

`mapUserRow` checks `promo_team_id` against the **known team ids Set** passed in. If unknown → emit `null` for that field (don't drop the user). Avoids FK violation while keeping the user record.

## Content windowing

`from/to` query params, ISO date `YYYY-MM-DD`. Default 30 days. Set `SYNC_CONTENT_WINDOW_DAYS` higher (e.g. 365) for full-history fixture-range mapping.

**Implication**: `basket_mat_fixture_ranges` falls back to `source_sheet` slug for fixtures whose match id isn't in the content window. Resolves automatically on next sync that includes that date.

## Sheets discovery

`composeRunSync` walks `process.env` once per run:

1. `GOOGLE_SHEETS_ID_INCIDENCIAS` → single sheet spec.
2. `GOOGLE_SHEETS_ID_GRILLA` → `listTabs()` → keep tabs matching month regex → one spec per month.
3. `GOOGLE_SHEETS_FIXTURE_<LABEL>_ID` (+ `_TAB` or `_TABS`) → one fixture spec per tab. Parse season-year from tab name.
4. Each fixture workbook id → `listTabs()` → find `/^data$/i` tab → one DataSheetSpec per workbook.

New league = env var only.

## Mat-view refresh

`RefreshMaterializedViewsUseCase.execute({ concurrent: true })` runs:
```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY basket_mat_daily_active;
REFRESH MATERIALIZED VIEW CONCURRENTLY basket_mat_monthly_lifecycle;
REFRESH MATERIALIZED VIEW CONCURRENTLY basket_mat_team_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY basket_mat_revenue_daily;
REFRESH MATERIALIZED VIEW CONCURRENTLY basket_mat_fixture_ranges;
```

Each has a `CREATE UNIQUE INDEX` so `CONCURRENTLY` never blocks readers. `RefreshResult[]` per view (`view, durationMs, ok`) returned and surfaced in `RunSyncResult.refreshes`.

## Cron

`SyncScheduler` wraps `node-cron`. Cadence from `SYNC_INTERVAL_HOURS`. Registered in `src/app/layout.tsx` only when `NODE_ENV === 'production' && typeof window === 'undefined'` — keeps dev server quiet.

For Vercel-style deploys without long-lived process: replace cron with a Vercel Cron Job hitting `POST /api/basket/sync` with the `x-sync-token` header. No code changes needed.

## RunSyncResult shape

```ts
{
  startedAt, finishedAt, durationMs,
  syncedUsers, syncedPayments, syncedTeams, syncedTournaments, syncedContent,
  syncedSheets:      { sheet, inserted }[],     // -1 = stage failed
  syncedFixtures:    { sheet, inserted }[],     // -1 = stage failed
  syncedDataMasters: { workbook, teams, cambios, dias }[],
  refreshes:         { view, durationMs, ok }[],
}
```

`GET /api/basket/sync` returns the latest snapshot + an `inFlight` flag (in-memory lock to prevent overlapping runs).

## Failure isolation summary

| Stage class | On failure |
|---|---|
| Tournaments / Teams / Users / Payments / Content | Aborts whole run (FK-critical) |
| Generic Sheets (incidents, grilla) | Logged + `inserted: -1`, continues |
| Fixture Sheets (per league) | Logged + `inserted: -1`, continues |
| DATA masters (per workbook) | Logged + `teams/cambios/dias = -1`, continues |
| Mat-view refresh | Logged per-view in `RefreshResult.ok = false`, continues |

## Verification commands

```bash
pnpm smoke:sync       # full end-to-end run + counts
pnpm smoke:queries    # round-trip every BFF DTO
pnpm views:refresh    # refresh mat views standalone
pnpm db:studio        # inspect rows visually
```
