# 01 · Product Overview

## What this is

A live analytics dashboard for **BasquetPass (BP)** — a basketball streaming platform. Replaces a static `~6MB` HTML file (`data/basket_dashboard_29.html`) with embedded pre-computed JSON.

Pipeline: external sources (CSV API + Google Sheets) → Postgres (raw + materialized) → BFF endpoints → Next.js dashboard.

## Who uses it

- **Product / business**: operating metrics (active users, churn, revenue per currency, team-level traction).
- **Operations**: monitor sync health, data quality issues, broadcast/fixture calendar.
- **Content team**: cross-reference fixtures vs produced matches.

## Why rebuild

| Legacy HTML | New dashboard |
|---|---|
| Static, ~6 MB, regenerated offline | Live, server-rendered, queryable |
| Cannot filter dynamically | Filterable by country / access / sub-type |
| No sync visibility | `basket_sync_state` + last-sync badge |
| Single user, single file | Multi-tab, multi-module-ready |
| Hard to extend | Hexagonal core; new modules slot in by prefix |

## Success criteria

1. KPI numbers on `OverviewTab` match the legacy HTML for the same `asOf` date.
2. Sync is idempotent — running twice changes 0 rows.
3. Materialized views feed every tab in **< 200 ms** per route (Phase 2 target met: < 130 ms).
4. New countries / leagues require **env var only**, no code change (auto-discovery in `composeRunSync`).
5. Multi-module ready: any future module (`football`, `volley`, etc.) lives under its own prefix without touching `basket_*`.

## Modules

Current: **basket** only. Designed for `<module>_` table prefix + `/api/<module>/*` routes + per-module Zustand store. See `02-architecture.md` for the boundary rule.

## Out of scope (current)

- Auth on GET routes (deferred to Phase 7).
- Currency FX normalization.
- Live `/events_playing` ingestion (hourly cadence TBD).
- Live `/payments` from API (token scope blocks it — uses local CSV).
- Phase / playoff band annotations on EvolutionTab (needs sheet hint).
