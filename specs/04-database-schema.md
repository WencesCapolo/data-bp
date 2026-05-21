# 04 · Database Schema

Postgres 16. Drizzle ORM (pg-core). All tables prefixed `basket_` for multi-module coexistence.

Migration files (idempotent, applied in order):

| # | File | Adds |
|---|---|---|
| baseline | (Drizzle push) | `basket_teams`, `basket_leagues`, `basket_users`, `basket_payments`, `basket_fixtures`, `basket_sync_state` |
| 0001 | `migrations/sql/0001_views.sql` | `basket_v_active_payments` + 4 mat views |
| 0002 | `migrations/sql/0002_tournaments_content_sheets.sql` | `basket_tournaments`, `basket_content`, `basket_sheet_rows` |
| 0003 | `migrations/sql/0003_fixture_matches.sql` | `basket_fixture_matches` + `basket_mat_fixture_ranges` |
| 0004 | `migrations/sql/0004_data_masters.sql` | `basket_team_master`, `basket_cambios_enum`, `basket_dias_enum` |

## Raw tables

### `basket_users` — User registry
PK `id`. Columns: `idx, email, firstname, lastname, created_at, login_at, status, last_status, promo_team_id (→basket_teams), promo_team_changed_at, play_token, roles, country, email_verified, synced_at`.
Indexes: `country`, `promo_team_id`, `status`.

### `basket_payments` — Subscription/payment ledger
PK `id`. Columns include `user_id, platform, product_id, price_id, content_id, amount, currency, recurrent, expires_at, created_at, status, status_detail, keycode, payment_country, synced_at`.
Indexes: `user_id`, `created_at`, `expires_at`, **composite `(status, expires_at)`** (critical for active queries), `platform`.

### `basket_teams` — Teams (live + curated)
PK `id`. Columns: `team_name, league, country, tier, type` (curated: league/tier/type).
Partial merge on sync: insert sets `league='Unknown',tier=1,type='regular'`; update preserves curated fields.

### `basket_tournaments`
PK `id`. `name, country`. Used to label fixtures via JOIN through `basket_content`.

### `basket_content` — Match/content registry from BP backend
PK `id`. Holds `tournament_id`, team ids, scores, dates (created/updated/spawn/live), views counters. Source-of-truth for cross-sheet ID joins.

### `basket_fixture_matches` — League fixture calendar (from Google Sheets)
PK `id` (BP match id). `match_date, match_time, home_team, away_team, venue, broadcaster, source_sheet, synced_at`.
Indexes: `match_date`, `source_sheet`.

### `basket_sheet_rows` — Generic sheet JSONB store
Composite PK `(sheet, row_key)`. `data` JSONB. Used for `incidents` + `grilla_<month>`.

### `basket_team_master` / `basket_cambios_enum` / `basket_dias_enum`
DATA-tab masters. PK = `(workbook_label, name_full | label)`. See 03-data-sources for parser layout.

### `basket_fixtures` — Legacy phase boundaries
Pre-populated from legacy HTML. Will be replaced by `basket_mat_fixture_ranges` derivations.

### `basket_sync_state`
PK `source` (string). Sources observed:
- `users`, `payments`, `teams`, `tournaments`, `content`
- `sheet:incidents`, `sheet:grilla_<month_slug>`
- `fixture:<source_sheet_slug>`
- `data:<WORKBOOK_LABEL>`

## Single source-of-truth view

`basket_v_active_payments` — enriches `status=1` payments with:
- `sub_type` (Free / Mensual_Basico / Mensual_Total / Anual_Total / Otros)
- `access_type` (real / voucher / antel)
- `platform_name` (Mercadopago / Manual / Voucher / PayPal / Stripe / Antel)
- Pre-joined user country + team (via `promo_team_id`)

All mat views read from this view. `status=1` filter applied once at the bottom.

## Materialized views

| View | Grain | Feeds | Refresh |
|---|---|---|---|
| `basket_mat_daily_active` | 1 row / day | OverviewTab, EvolutionTab | CONCURRENTLY after every sync |
| `basket_mat_monthly_lifecycle` | 1 row / month | RetentionTab | same |
| `basket_mat_team_monthly` | team × month | TeamsTab (rank + drill-down) | same |
| `basket_mat_revenue_daily` | day × currency × user_country × platform | FinanceTab | same |
| `basket_mat_fixture_ranges` | league × country | (future EvolutionTab bands) | same |

### `basket_mat_daily_active`

Computes per day:
- `all_active`, `real_active`, `voucher_active`, `antel_active`
- per-subtype: `free_active`, `mensual_basico_active`, `mensual_total_active`, `anual_total_active`
- per-country: `uy_active`, `ar_active`, `cl_active`, `other_active`

Single pass: `LEFT JOIN basket_v_active_payments ON created_at::date <= d AND (expires_at + 7d)::date >= d`, then `COUNT(DISTINCT user_id) FILTER (...)` per split.

Bounded: `d_min = GREATEST(MIN(created_at)::date, '2020-01-01')`, `d_max = LEAST(MAX((expires_at + 7d))::date, CURRENT_DATE)`.

### `basket_mat_monthly_lifecycle`

CTE pipeline:
1. `per_user_payment` — adds `created_month`, `expire_month`, `LAG(expires_at)` prev_expires per user.
2. `first_payment` — earliest `status=1` payment per user → `new_payers`.
3. `renewals` — created within 37 days of prev_expires.
4. `reactivations` — created after 37 days from prev_expires.
5. `expirations` — payments with no successor that covers the expiry window.
6. `active_at_month` — for each month emits `active_start` (day 1) and `active_end` (last day of month).

Then merge → `churn_rate_pct = expirations / active_start × 100`, `retention_rate_pct = 100 - churn_pct`.

### `basket_mat_team_monthly`

Per `(team_id, month)`: `unique_payers`, `total_payments`, `total_amount`, `real_payers`, `voucher_payers`. `team_id = 0` bucket holds users with no `promo_team_id`.

### `basket_mat_revenue_daily`

Per `(day, currency, user_country, platform)`: `payment_count`, `total_amount`, `real_count`, `real_amount`.
Filter: `amount > 0 OR platform = 9` (Antel counts even with `amount = 0`).

### `basket_mat_fixture_ranges`

Per `(league, country)`: `start_date`, `end_date`, `match_count`. Derived from `basket_fixture_matches` JOIN `basket_content` JOIN `basket_tournaments`. League name falls back to `source_sheet` slug when no content row matches yet (gets re-labeled on next content sync if window includes the match).

## Indexes — query path map

| Query | Index used |
|---|---|
| Active users on day D | `basket_payments(status, expires_at)` + `(created_at)` |
| Revenue in range | `basket_mat_revenue_daily(day)` |
| Team rank | `basket_mat_team_monthly(team_id, month)` (PK) |
| Country slice | `basket_users(country)` |
| Fixture by date | `basket_fixture_matches(match_date)` |
| Sheet row lookup | `basket_sheet_rows(sheet, row_key)` (PK) |

## Date storage

- Timestamps `TIMESTAMPTZ`, all UTC.
- Sheets-derived dates stored UTC midnight (no source TZ; treat as wall-clock).
- `basket_users.country` and `basket_users.promo_team_id` are nullable (live API doesn't always provide).
