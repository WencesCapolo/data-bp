# 08 · Dashboard Walkthrough

Tab-by-tab tour. Each section: **what it shows**, **how to read it**, **data path** (DTO → SQL source), **filters that apply**.

---

## Tab 1 · Visión General (OverviewTab)

**Goal**: one-screen snapshot of "where the platform is **right now**".

**KPI grid** (8 cards):
- **Activos totales** — distinct active users as of `asOf` (default today). The headline number.
- **Pagos reales** — paid (`access_type=real`).
- **Vouchers** — promo/free (`access_type=voucher`).
- **Antel** — Antel-bundled (`access_type=antel`, `platform=9`).
- **Mensual básico / total / Anual total** — subtype breakdown of the active base.
- **Nuevos pagadores 30d** — count of users whose first `status=1` payment landed in the last 30 days.

**Trend 30 días · línea**: stacked area-ish line of `allActive / realActive / voucherActive` for the last 30 days. Shows recent direction at a glance.

**Mix de acceso · doughnut**: share of active base across access types — quickly reveals voucher dependency.

**Distribución por país · doughnut**: where the active base lives (Uruguay vs Argentina vs Chile vs Otros).

**Mix por subtipo · bar**: subtype share — diagnose whether growth is in Free vs Mensual vs Anual.

**Revenue últimos 30 días (per currency)**: aggregated paid amount per currency (UYU, USD, ARS, CLP, BRL). No FX normalization.

**Insights**: auto-text — total active + country count + dominant subtype %.

**Data path**:
- KPIs → `basket_mat_daily_active` (latest row) + `basket_mat_revenue_daily` (last 30 days)
- Breakdowns → same view, FILTER per dimension
- Trend → 30 rows of `basket_mat_daily_active`

**Filters applied**: `countries[]`, `accessType`, `subType` (full filter push-down deferred — currently affects breakdowns shown, not the headline KPI).

**Endpoint**: `GET /api/basket/overview?asOf=&countries[]=&accessType=&subType=`

---

## Tab 2 · Evolución Histórica (EvolutionTab)

**Goal**: how the active base evolved over time, by access type and subtype.

**KPI grid**:
- **Activos al final** — latest bucket's `allActive`.
- **Pico en rango** — peak `allActive` in the selected range.
- **Variación** — last − first delta (absolute + %).
- **Buckets** — count of buckets rendered (granularity-dependent).

**Charts**:
1. **Activos por tipo de acceso · stacked area** (real / voucher) — composition over time. Bottom note adds Antel.
2. **Mix por subtipo · stacked area** (Free / M.básico / M.total / Anual total) — subtype shift over time.
3. **Total activos · línea** — overall trajectory.

**Bandas de fase deportiva (alert-box)**: surfaces a TODO — when range is filtered to **1 country + 1 league**, the chart should overlay league season/playoff bands derived from `basket_mat_fixture_ranges`. Pending (Phase 7).

**Data path**: `basket_mat_daily_active` aggregated to chosen `granularity` (day/week/month) inside the use-case.

**Filters**: `range`, `granularity`, `countries[]`, `accessType`, `subType`.

**Endpoint**: `GET /api/basket/evolution?range=&granularity=&...`

**Reading tip**: divergence between Total and Real lines = voucher contribution. Widening = increasing reliance on promo activity.

---

## Tab 3 · Análisis por Equipo (TeamsTab)

**Goal**: which teams pull users.

**KPI grid**:
- **Equipos con pagadores** — count of teams that had ≥ 1 payer in range.
- **Pagadores únicos** — sum of `uniquePayers` across teams.
- **Pagos totales** — sum of `totalPayments`.
- **Top equipo** — name + payment count of the leader.

**Ranked table** (sortable cols: Equipo / Pagadores / Pagos / Monto):
- Rank, Team, League, Country, Pagadores, Pagos, Monto, expander
- Click row → drill-down: per-team `LineChart` of `uniquePayers` + `totalAmount` over months (`/api/basket/teams/[teamId]/trend`).

**Sin equipo bucket**: `team_id = 0` row represents users with no `promo_team_id` linkage — useful to spot rising "loose" demand.

**Data path**: `basket_mat_team_monthly` aggregated over range. Drill-down hits same view filtered by `team_id`.

**Filters**: `range`, `countries[]`, `accessType`, `subType`. Limit hard-capped at 500.

**Endpoint**: `GET /api/basket/teams?range=&limit=100&...` + `GET /api/basket/teams/:teamId/trend`

**Reading tip**: sort by Monto to find revenue-generating teams; sort by Pagadores to find demand. Compare ratio Monto/Pagadores for ARPU per team.

---

## Tab 4 · Análisis Financiero (FinanceTab)

**Goal**: revenue shape — by day, currency, platform.

**KPI grid**:
- **Pagos en rango** — total payment count.
- **Top moneda** — currency with highest revenue + formatted amount.
- **Plataformas** — count of distinct platforms with payments.
- **Monedas** — count of currencies billed.

**Ingresos diarios por moneda · línea (multi-series)**: one line per currency. No FX — each currency on its own scale (visual overlap intentional).

**Distribución por moneda · doughnut**: share by total amount (face value).

**Plataforma · monto y conteo · table**: `byPlatform` rows — payment count, total amount, real-only count + amount.

**Platform monthly · stacked**: revenue evolution per platform per month — surfaces shifts (e.g. PayPal → Stripe migration, Antel ramp-up).

**Data path**: `basket_mat_revenue_daily`.

**Filters**: `range`, `countries[]`, `accessType`, `subType`.

**Endpoint**: `GET /api/basket/finance?range=&...`

**Reading tip**: payment count >> real_count = lots of vouchers. Currency mix shift can reveal market expansion.

---

## Tab 5 · Retención / Churn (RetentionTab)

**Goal**: subscription lifecycle health — who joined, renewed, lapsed.

**KPI grid**:
- **Churn último mes** — `expirations / active_start × 100` for latest month.
- **Retención último mes** — `100 - churn`.
- **Churn promedio** / **Retención promedio** — across all months in store.

**Lifecycle mensual · stacked bar** (Nuevos / Renovaciones / Reactivaciones / Expiraciones-as-negative):
- New: first-ever `status=1` payment that month.
- Renewal: payment within 37 days of previous expiry (allows 30d cycle + 7d grace).
- Reactivation: payment > 37 days after previous expiry → user came back.
- Expiration (shown negative): last covered day fell in this month.

Net = green-blue-purple positives + red negative below = visualized net flow.

**Churn y retención · % · línea**: two lines on a 0-100% axis. Inverse curves (they sum to 100% by definition).

**Lifecycle table**: full per-month grid, reverse-chronological.

**Data path**: `basket_mat_monthly_lifecycle` (5-CTE compute).

**Filters**: none — whole-history view.

**Endpoint**: `GET /api/basket/retention`

**Reading tip**: rising Reactivations = re-engagement working. Rising Expirations + falling Renewals = churn problem.

---

## Tab 6 · Calidad de Datos (DataQualityTab)

**Goal**: data integrity and sync freshness.

**KPI grid**: Users count, Payments count, Teams count, "Generated at" timestamp.

**Issues table**: each row is a deterministic check with a `code`, `description`, `count`, `% del total`, `severity` badge.

Known codes:
- `payment_orphan` — payments referencing user_id not in `basket_users`.
- `paid_zero_non_antel` — `amount = 0` payments not on Antel platform.
- `user_no_country` — users with NULL country.
- `user_unknown_team` — users with `promo_team_id` set but team missing.

Severity heuristic:
- `payment_orphan` / `paid_zero_non_antel` → high regardless of count
- count > 5000 → high
- count > 500 → med
- else → low

**Estado de sincronización**: per-source sync timestamp + row count + age badge (green < 12h, yellow 12-36h, red > 36h).

**Rango de datos disponible (alert-box)**: shows `dataRange.minDay`–`dataRange.maxDay` from meta — quick sanity check on coverage.

**Data path**:
- Issues — direct counts on `basket_payments` + `basket_users` + `basket_teams`
- Totals — `count(*)` per table
- Sync state — `basket_sync_state` via meta endpoint

**Endpoint**: `GET /api/basket/data-quality` + `GET /api/basket/meta`

**Reading tip**: any `high` row blocks downstream confidence. Sync ages > 36h on `users`/`payments` mean dashboards are stale.

---

## Cross-tab patterns

| Pattern | Where |
|---|---|
| `kpi-grid` → 4-8 cards top of each tab | All tabs |
| Skeleton + ErrorBox inline | All tabs |
| Auto-text "Insights" block | Overview |
| Drill-down via row expand | Teams |
| Per-currency split (no FX) | Overview, Finance |
| Country = user country (not payment country) | Default everywhere; `payment_country` available in `basket_payments` if needed |
| 7-day grace on active window | Reflected in every "active" metric |

## Numbers cross-check

- KPI active total on tab 1 = `SELECT all_active FROM basket_mat_daily_active WHERE day = CURRENT_DATE`.
- Legacy HTML (`data/basket_dashboard_29.html`) for date 2026-05-03 → 27,658 active. Use same date for parity check.

## Hidden / future signals

- `basket_mat_fixture_ranges` is computed but not yet rendered. Will feed Evolution league bands.
- DATA-tab masters (`basket_team_master`, `cambios_enum`, `dias_enum`) populated per workbook — not yet shown in any tab. Candidates: TeamsTab metadata enrichment, fixture filter dropdowns.
- `basket_content` views/seconds counters not yet surfaced — engagement tab candidate.
