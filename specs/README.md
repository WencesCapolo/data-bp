# Specs — BasquetPass Data Platform

Authoritative reference. Cross-checked against the code in `src/` and the legacy gold-standard dashboard `data/basket_dashboard_29.html`.

## Index

| # | File | Scope |
|---|---|---|
| 00 | [business-rules.md](business-rules.md) | Domain rules: classification, active window, sync sources, fixture column variants |
| 01 | [01-overview.md](01-overview.md) | Product overview, audience, goals, success criteria |
| 02 | [02-architecture.md](02-architecture.md) | Hexagonal layout, module boundaries, dependency rule |
| 03 | [03-data-sources.md](03-data-sources.md) | External CSV API, Google Sheets, DATA tabs |
| 04 | [04-database-schema.md](04-database-schema.md) | Raw tables, view, materialized views, indexes |
| 05 | [05-sync-pipeline.md](05-sync-pipeline.md) | Sync stages, idempotency, failure isolation, cron |
| 06 | [06-api-routes.md](06-api-routes.md) | BFF endpoints, DTOs, Zod validation |
| 07 | [07-frontend.md](07-frontend.md) | Next.js shell, state, charts, conventions |
| 08 | [08-dashboard-walkthrough.md](08-dashboard-walkthrough.md) | Tab-by-tab walkthrough, KPIs, insights |
| 09 | [09-development-plan.md](09-development-plan.md) | Phase status, pending work, roadmap |
| 10 | [10-conventions.md](10-conventions.md) | Naming, tooling (pnpm, podman), patterns |

## Reading order

- New contributors: 01 → 02 → 04 → 05 → 06 → 07 → 08
- Domain analysts: 00 (business-rules) → 08 (walkthrough)
- Ops / sync debugging: 03 → 05 → 04
- Frontend work: 07 → 08 → 06

## Critical reference

`data/basket_dashboard_29.html` — legacy static dashboard. Every aggregation cross-checked against its `DATA.*` keys. Authoritative when in doubt about a number, label or color.
