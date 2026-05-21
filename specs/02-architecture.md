# 02 · Architecture

## High-level

```
Google Sheets ─┐
External CSV ──┼─▶ Sync Use-Cases ─▶ Postgres (raw) ─▶ Materialized Views
              ─┘            │                                    │
                       Sync State                                │
                            │                                    ▼
                            │                          Query Use-Cases (BFF DTOs)
                            ▼                                    │
                    Cron (every 6h)                              ▼
                                                       Next.js Route Handlers
                                                                 │
                                                                 ▼
                                                        React tabs (SWR + Zustand)
                                                                 │
                                                                 ▼
                                                          Chart.js charts
```

## Hexagonal layout

Per-module folder rooted at `src/modules/<module>/`. Currently only `basket`.

```
src/modules/basket/
├── core/                           ← Pure domain. No I/O.
│   ├── entities/                   User, Payment, Team, Tournament, Content, FixtureMatch
│   ├── value-objects/              AccessType, Platform, SubType
│   ├── dtos/                       Tab-shaped response DTOs (OverviewDTO, EvolutionDTO, …)
│   ├── ports/                      Interfaces (IUserRepository, ISheetsFetcher, IAnalyticsQueryRepository, …)
│   └── use-cases/
│       ├── sync/                   Load*FromCsv, LoadSheet, LoadFixtures, LoadSheetDataMasters, RunSync, RefreshMatViews
│       └── queries/                GetOverview, GetEvolution, GetRetention, GetFinance, GetTeams, GetMeta, GetDataQuality
├── infrastructure/                 ← Adapters. Touch the world.
│   ├── csv/                        CsvApiFetcher (HTTPS w/ IPv4 family pin)
│   ├── sheets/                     GoogleSheetsFetcher (service-account JWT)
│   ├── db/
│   │   ├── schema.ts               Drizzle pg-core tables
│   │   └── repositories/           Drizzle{Entity}Repository  →  implements core port
│   ├── sync/                       composeRunSync, csvMappers, fixtureMappers, sheetDataMapper
│   └── cron/                       SyncScheduler (node-cron)
└── presentation/                   ← (optional) module-local components/hooks if not in src/components
```

## Dependency rule

**Inward only.** `infrastructure/` and `presentation/` import from `core/`. Never the reverse. `core/` imports only from itself and from `@shared/*` for cross-cutting plumbing (db client).

Enforced by import paths (`@basket/core/...`, `@basket/infrastructure/...`, `@shared/db/...`). TS aliases in `tsconfig.json`.

Use-cases depend on **port interfaces**, never on Drizzle types. Wiring of concrete repos happens once in `composeRunSync.ts` (sync) and `src/lib/api/composeRepo.ts` (queries).

## Two compositions

| File | Wires | Triggered by |
|---|---|---|
| `infrastructure/sync/composeRunSync.ts` | All repos + fetcher + sheets + use-cases for **writes** | `POST /api/basket/sync`, cron, `scripts/smoke-sync.ts` |
| `src/lib/api/composeRepo.ts` | `DrizzleAnalyticsQueryRepository` for **reads** | Each query route handler |

Split keeps read paths free of sync-only dependencies (sheets client, CSV fetcher, etc.).

## Shared layer

```
src/shared/
├── db/client.ts         postgres-js client + Drizzle wrapper, exported as `db`
└── lib/                 cross-module utilities (none yet)
```

## Multi-module rule

- Tables prefixed `<module>_`
- API routes under `/api/<module>/...`
- Zustand stores module-scoped (no global filter store across modules)
- `basket_sync_state.source` is a string key — other modules add their own rows

## Discovery, not hardcoding

`composeRunSync` walks `process.env` for `GOOGLE_SHEETS_FIXTURE_<LABEL>_ID` and pairs with `_TAB` / `_TABS`. New country/league = env var only. No code change.

DATA tabs discovered case-insensitively (`/^data$/i`) inside each fixture workbook. Grilla month tabs discovered via `/^(Enero|...|Diciembre)\s+\d{2,4}$/i`.

## Performance posture

- **Reads** hit materialized views, never raw `basket_payments` (except DataQuality + Collection).
- **Single-pass aggregations**: every split (`real`, `voucher`, `antel`, per-country, per-subtype) computed in one pass via Postgres `FILTER` clauses.
- **`REFRESH MATERIALIZED VIEW CONCURRENTLY`** so reads never block during refresh.
- All `mat` views have `CREATE UNIQUE INDEX` to enable `CONCURRENTLY`.

## Error / failure isolation

Sync stages run sequentially but **sheet stages are isolated**: failure in one sheet logs + reports `inserted: -1`, others continue. CSV stages (tournaments, teams, users, content) abort the whole run on error — they have FK dependents.
