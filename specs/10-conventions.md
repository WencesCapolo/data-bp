# 10 · Conventions

## Tooling

- **Package manager**: `pnpm` (not npm).
- **Containers**: `podman` (not docker). Postgres container `data-bp-postgres-1`.
- **Node**: 24+. (Note: undici IPv6 quirk — see `03-data-sources.md`.)
- **Postgres**: 16.
- **TypeScript**: 5, strict.
- **ESLint**: flat config in `eslint.config.mjs`.

## Scripts

```bash
pnpm dev                # next dev
pnpm build              # next build
pnpm start              # prod server
pnpm lint               # eslint

pnpm db:push            # drizzle-kit push (dev)
pnpm db:generate        # drizzle-kit generate (migrations)
pnpm db:migrate         # drizzle-kit migrate
pnpm db:studio          # drizzle-kit studio (visual inspect)

pnpm views:apply        # apply migrations/sql/*.sql in order
pnpm views:refresh      # REFRESH MATERIALIZED VIEW CONCURRENTLY x5

pnpm sync:initial       # one-shot bootstrap from local CSVs
pnpm smoke:sync         # end-to-end sync + counts
pnpm smoke:queries      # round-trip every BFF DTO
pnpm smoke:api          # hit running server, validate Zod-side
```

All `scripts/*.ts` ran via `tsx --env-file=.env`.

## Naming

| Concern | Pattern |
|---|---|
| Module folder | `src/modules/<module>/` |
| Table | `<module>_<entity>` (e.g. `basket_users`) |
| Materialized view | `<module>_mat_<grain>` (e.g. `basket_mat_daily_active`) |
| View (non-mat) | `<module>_v_<name>` |
| Index | `<table>_<col[s]>_idx` |
| Port | `I<Thing>Repository` / `I<Thing>Fetcher` |
| Adapter | `Drizzle<Thing>Repository` / `<Source><Thing>Fetcher` |
| Use-case | `<Verb><Thing>UseCase` (e.g. `LoadUsersFromCsvUseCase`, `GetOverviewUseCase`) |
| DTO | `<Tab>DTO` (e.g. `OverviewDTO`) |
| Sync state source | `users`, `teams`, `sheet:<name>`, `fixture:<slug>`, `data:<WORKBOOK>` |
| Logical sheet slug | `fixture_<label>` single / `fixture_<label>_<tab_slug>` multi / `grilla_<month_slug>` |

## TypeScript path aliases

```jsonc
{
  "@basket/*":   "src/modules/basket/*",
  "@shared/*":   "src/shared/*",
  "@/*":         "src/*"
}
```

Use `@basket/core/...` in domain code, `@basket/infrastructure/...` in adapters. Avoid relative `..` chains.

## Imports rule (hex arch)

- `core/` imports from: `core/`, `@shared/*`
- `infrastructure/` imports from: `core/` ports, libraries, `@shared/db`
- `presentation/` and `src/components/`: imports from `core/dtos`, never from `infrastructure/`
- API routes (`src/app/api/...`): import use-cases (from `core/`) + `composeRepo()` factory

## Patterns

### BFF DTO pattern

Each API endpoint returns the **exact** shape needed by its tab. No client-side reshaping. SQL does heavy lifting (single pass via mat views + `FILTER`). DTO field names align with chart configs.

### Composition root

Two single files do all wiring:
- `infrastructure/sync/composeRunSync.ts` — writes side
- `src/lib/api/composeRepo.ts` — reads side

Use-cases never `new` repos themselves.

### Streaming + batching

CSV ingestion is stream-based (`csv-parse` + `AsyncGenerator`). Upserts batched at 500 rows. Avoids loading whole payload into memory.

### `onConflictDoUpdate` everywhere

All upserts use Drizzle's `onConflictDoUpdate({ target: pk, set: ... })`. Idempotency guaranteed by PK.

### Partial-merge for live-source fields

When live source provides a subset of columns (e.g. `/teams` lacks `league/tier/type`), the adapter sets defaults on insert but excludes curated cols from update set. See `DrizzleTeamRepository.upsertManyFromLive`.

### Discovery, not config

Env var → discovery → spec list. New league = env var only. New month tab = next sync picks it up automatically.

### Single source-of-truth view

`basket_v_active_payments` applies `status=1` filter + classification once. All mat views read from it. Change classification rules in one place.

### Failure isolation by stage class

Sheet stages don't roll back CSV stages. Failed sheet → `inserted = -1` in result, sync continues.

## Code style

- No comments unless the *why* is non-obvious.
- Don't write WHAT the code does — name things well.
- No backwards-compatibility shims, no feature flags for hypothetical futures.
- No multi-paragraph docstrings.
- Edit existing files; don't create new ones unless required.
- TypeScript first; no `any` unless boundary-layer.
- Prefer composition over inheritance. No mixins.

## Commit / PR style (Conventional Commits via `/caveman:caveman-commit`)

```
<type>(<scope>): <imperative>

<body if WHY non-obvious>
```

Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`, `ci`, `style`, `revert`.

Subject ≤ 50 chars (hard cap 72). No trailing period. No AI attribution. No "I/we/now/currently".

## Logging

- Sync failures: `console.error('sheet X failed:', err.message)` — keep message terse.
- Server errors: `serverError(err)` helper logs full stack server-side, returns sanitized JSON.

## Time zones

All DB columns `TIMESTAMPTZ`. Sheets-derived dates stored UTC midnight (no source TZ; wall-clock match date). Display uses `es-UY` locale (`Intl.DateTimeFormat`, `Intl.NumberFormat`).

## Currency

Stored uppercase, max 10 chars. No FX. Each currency aggregated independently in `basket_mat_revenue_daily`. Display: `Intl.NumberFormat('es-UY', { style: 'currency', currency })`.

## Testing strategy (current)

- **Smoke scripts** (`scripts/smoke-*.ts`) — exercise full path with real DB.
- **No unit-test runner** yet. When added: Vitest is the chosen direction. Test the use-cases (pure), mock the ports.
- **Probe scripts** (`scripts/probe-*.ts`) — one-off Sheets/CSV exploration. Keep as documentation of empirical findings.

## Permission / risk posture

- Destructive ops (drop table, force push, reset --hard) — always confirm.
- Migrations are additive only. Renames/drops require explicit user approval.
- `--no-verify`, `--no-gpg-sign` — never.
