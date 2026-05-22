# 09 · Development Plan

Phase-by-phase status, gates, and what remains.

## Status board

| Phase | Scope | Status |
|---|---|---|
| 1 | Infra: Postgres, Drizzle schema, initial CSV load, active view | ✅ done |
| 2 | Materialized views (4 core + fixture ranges) + BFF DTOs + query use-cases | ✅ done |
| 3 | Sync layer: CsvApiFetcher, upsert use-cases, sync state, refresh, cron | ✅ done |
| 4 | API layer: 8 GET routes + sync POST + Zod + composeRepo | ✅ done |
| 5 | Frontend shell: layout, Zustand, SWR, chart wrappers, OverviewTab | ✅ done |
| 6 | All 6 tabs (Overview, Evolution, Teams, Finance, Retention, DataQuality) | ✅ done |
| 7 | Polish: skeletons, error boundaries, sync badge, perf, URL state | ⏳ partial |
| 8.1 | Live API ingestion: token auth, tournaments, teams partial-merge | ✅ done |
| 8.2 | Content table + windowed sync | ✅ done |
| 8.3a | GoogleSheetsFetcher service-account auth | ✅ done |
| 8.3b | Sheet tables for incidents / production_grid / total_matches | ⏳ partial — incidents + grilla wired; production_grid / total_partidos pending |
| 8.4 | Fixture matches: table + repo + mapper (3 column variants) + sheet discovery | ✅ done |
| 8.5 | DATA-tab masters: team / cambios / dias enums + multi-column-block parser | ✅ done |

## Gates already met

- Phase 1: active count from DB = 26,057 (`status=1`) ✅
- Phase 2: active users from `basket_mat_daily_active` on 2026-05-03 = 27,658 (matches legacy HTML) ✅
- Phase 3: sync idempotent — second run = 0 row delta ✅
- Phase 4: all routes < 200 ms ✅ (smoke shows < 130 ms median)
- Phase 6: 6 tabs rendering; all DTOs round-trip via `smoke:api` ✅

## Outstanding work

### Phase 7 — Polish (small, focused)

- [ ] Replace inline `ErrorBox` with React error boundary per tab.
- [ ] Unify skeleton primitives (one `ChartSkeleton` per height).
- [ ] URL ↔ filter state sync (deep-link tabs + filters).
- [ ] Cache-Control / ETag on stable routes (`/meta` could 304).
- [ ] Sync status: surface `inFlight=true` more loudly in Header.
- [ ] Basic smoke perf check: `evolution?range=all` < 500 ms.

### Phase 8.3b — Remaining sheet tables (deferred)

**Decision**: JSONB in `basket_sheet_rows` is sufficient for operational sheets. No normalized tables until a tab actually surfaces them. Status: **deferred until UI demand**.

- [~] `production_grid` → kept as JSONB rows under `grilla_<month>` source slugs. Already ingested per-month tab. No dedicated table.
- [~] `total_partidos` (`GOOGLE_SHEETS_ID_TOTAL_PARTIDOS`) → not wired. Aggregate-only sheet; revisit when an engagement/coverage tab needs it.
- [ ] Surface incidents / grilla rows in UI — pending Phase 9 (Engagement tab).

### Phase 8 follow-ups (deferred)

- [ ] Live `/events_playing` ingestion — define cadence + table shape (probably high-write, partitioned).
- [ ] Live `/payments` — blocked on token scope. Coordinate with BP backend or stay on local CSV.
- [ ] Phase / playoff band detection in fixture sheets — sheets don't expose phase. Heuristic: derive from match-number gaps + manual `cambios` taxonomy.

### Phase 9 (post-MVP) candidates

- [ ] Engagement tab (views / views_users / views_seconds from `basket_content`).
- [ ] Per-league filter (uses `basket_teams.league` + `basket_team_master`).
- [ ] Filter push-down to SQL across **all** routes (currently partial — `getTeams` has country single-string only).
- [ ] FX-normalized revenue view (rates table + materialized USD-equivalent column).
- [ ] Auth on GET routes (session/cookie).
- [ ] Multi-tenant (other modules: football, volley) — first new module proves the multi-module rule.

## File-level map of "what's done"

```
migrations/sql/                            ✅ 0001–0004 applied
src/modules/basket/core/                   ✅ entities, DTOs, ports, use-cases (sync + queries)
src/modules/basket/infrastructure/         ✅ csv, sheets, db repos, sync compose, cron
src/app/api/basket/                        ✅ 8 GET routes + sync GET/POST
src/components/{layout,tabs,ui,charts}/    ✅ all primitives + 6 tabs
src/lib/api/                               ✅ zodSchemas, responses, composeRepo
src/lib/client/                            ✅ filterStore, fetcher
scripts/                                   ✅ initial-load, smoke:queries, smoke:sync, smoke:api, refresh-views, probe-*
specs/                                     ✅ business-rules + 11 spec docs (this folder)
```

## Decision log (key choices)

| Decision | Why |
|---|---|
| Postgres mat views over a separate OLAP store | Single-process simplicity; mat-view refresh < 30 s; concurrency-safe with unique indexes |
| BFF DTOs per tab (no GraphQL) | DTO shape couples to a tab's needs; eliminates client reshape; Phase 2 proved < 130 ms |
| Drizzle (not Prisma) | Thin, SQL-first; mat views and raw SQL are first-class; smaller mental model |
| `?token=` query param auth for BP CSV API | Probed: Bearer/Cookie/None all 403; only `?token=` works |
| Local CSV for payments | Live `/payments` 403; token scope insufficient |
| Service account for Sheets | Long-lived, no OAuth roundtrip, scoped readonly |
| Multi-column-block parser for DATA tabs | Sheets shape is inherently non-relational; column-role classifier handles every workbook variant |
| Per-workbook PK for masters (`workbook_label`+name) | Same team name appears across leagues with different metadata; workbook is the scope |
| Auto-discovery via env vars | New league = env only. No code change, no migration |
| Composite single-pass SQL with `FILTER` | One scan emits all splits; mat view refresh in seconds vs minutes |
| 7-day grace on `expires_at` | Accommodates payment-processing delays; matches legacy dashboard semantics |
| No FX conversion | Each currency on its own scale; reflects business reality of multi-market pricing |
| Inline error/skeleton per tab (Phase 6) | Ship fast; unify in Phase 7 once shapes stable |

## Phase-end verification ritual

After any non-trivial change:
1. `pnpm smoke:sync` — full sync, idempotency check.
2. `pnpm smoke:queries` — every DTO returns shape-conformant JSON.
3. `pnpm dev` + manual click-through of all 6 tabs.
4. Cross-reference one KPI against `data/basket_dashboard_29.html`.
