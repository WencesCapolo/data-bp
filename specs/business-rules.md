# Business Rules — BasquetPass Data Platform

Authoritative reference for domain logic. Cross-checked against `data/basket_dashboard_29.html` (legacy dashboard, gold standard).

---

## Domain glossary

| Term | Meaning |
|------|---------|
| **BP** | BasquetPass — streaming platform for basketball |
| **Match ID** | Internal BP integer identifier assigned to a match/content unit. Globally unique across leagues |
| **Tournament** | A competition (league, cup, season). Spanish names as on source: `Liga Nacional`, `NBB CAIXA`, `Euroliga`, `LPB Fem Ecuador`, etc. |
| **Fixture** | Scheduled match in a league's calendar (may or may not be produced by BP) |
| **Produced match** | Match BP actually streams/broadcasts. Tracked in *Grilla Producción* sheet |
| **Active subscription** | Payment row where `status=1 AND created_at::date <= D AND (expires_at + 7d)::date >= D` for date `D` |
| **Tier** | League tier classification: 1=top, 2+=secondary |

---

## Match identification

**Source of truth: `basket_content.id` (integer PK).**

- ID assigned by BP backend when a match enters their system.
- Same ID flows through: `basket_content`, `basket_fixture_matches`, `basket_sheet_rows` (Grilla `ID` col, Incidencias `ID` col).
- Cross-source joins always on this ID.

**Fixture sheet rows without ID:**
- Either (a) BP will not work with that match, or (b) BP will work with it but hasn't yet entered it in the system.
- Behavior: **skip** those rows during sync (`mapFixtureMatchRow` returns null when `ID` empty or non-numeric).
- Result: `basket_fixture_matches` only contains BP-tracked matches.

**Fixture sheets list ALL league matches** (entire tournament calendar).
**Grilla lists only BP-produced matches** (subset that BP actually streamed).

---

## Subscription / payment classification

Implemented in view `basket_v_active_payments`.

### `sub_type` (subscription tier)
| Condition | Bucket |
|-----------|--------|
| `recurrent = 0` | `Free` |
| `recurrent = 30 AND price_id = 100010` | `Mensual_Basico` |
| `recurrent = 30 AND price_id IN (100030, 100011)` | `Mensual_Total` |
| `recurrent = 365` | `Anual_Total` |
| else | `Otros` |

### `access_type` (how user got access)
| Condition | Bucket |
|-----------|--------|
| `platform = 9` | `antel` (Antel ISP bundled) |
| `amount > 0` | `real` (paid) |
| else | `voucher` (free/promo) |

### `platform_name` (payment gateway)
| `platform` | Name |
|------------|------|
| 0 | MercadoPago |
| 1 | Manual |
| 2 | Voucher |
| 3 | PayPal |
| 4 | Stripe |
| 9 | Antel |

### `recurrent` values
- `0` = one-off / free
- `30` = monthly (30-day renewal)
- `365` = annual

### `status`
- `1` = active payment (only rows used in active calculations)
- Other values filtered out of `basket_v_active_payments`.

---

## Active subscription window

**Active on date D** iff:
```sql
status = 1
AND created_at::date <= D
AND (expires_at + INTERVAL '7 days')::date >= D
```

**Grace period: 7 days** after `expires_at` still counts as active (lenient — accommodates payment processing delays + brief lapses before renewal).

---

## User → team linkage

- `basket_users.promo_team_id` references `basket_teams.id`.
- If `promo_team_id` references unknown team, set NULL during sync (`mapUserRow`).
- View `basket_v_active_payments.team_id = u.promo_team_id`.

---

## Data sync sources

| Source | Type | Resource | Auth | Cadence |
|--------|------|----------|------|---------|
| Users | CSV | `EXTERNAL_API_BASE/users` | `?token=BP_TOKEN` | every sync |
| Payments | CSV | `EXTERNAL_API_BASE/payments` | same | **disabled** — token lacks scope; use local CSV |
| Teams | CSV | `EXTERNAL_API_BASE/teams` | same | every sync |
| Tournaments | CSV | `EXTERNAL_API_BASE/tournaments` | same | every sync |
| Content | CSV | `EXTERNAL_API_BASE/content` | same | windowed (`from/to`, default 30 days) |
| events_playing | CSV | `EXTERNAL_API_BASE/events_playing` | same | **not yet wired** — deferred (large, hourly cadence TBD) |
| Fixture sheets | Google Sheets | one per league/country | service account | every sync |
| Grilla Producción | Google Sheets | multi-tab (one per month) | service account | every sync |
| Incidencias | Google Sheets | single tab | service account | every sync |

### Live API token (`BP_TOKEN`)
- Sent as **query parameter** `?token=…`, not Bearer header.
- Confirmed via 4-variant probe (Bearer 403, Cookie 403, no-auth 403, `?token=` 200).
- Same token works for users/teams/tournaments/content. **403 on `/payments`** → token scope insufficient. Payments stays on local CSV.

### Node 24 fetch IPv6 workaround
- Node 24 + undici tries IPv6 first → `ENETUNREACH` (no local v6) → falls back v4 → `ETIMEDOUT`.
- Fix: `CsvApiFetcher` uses `node:https.request` with `new Agent({ family: 4, keepAlive: true })`.

---

## Teams sync — partial-merge rule

Live `/teams` CSV provides only `id, name, country`. Local DB also stores `league, tier, type` (curated).

**Upsert rule (`DrizzleTeamRepository.upsertManyFromLive`):**
- **Insert (new id):** set `league='Unknown'`, `tier=1`, `type='regular'`.
- **Update (existing id):** update **only** `team_name + country`. Preserve curated `league/tier/type`.

Trade-off: `basket_teams.league` is now NULLable (migration 0002) since some API-only teams lack league.

---

## Materialized views

| View | Grain | Refresh |
|------|-------|---------|
| `basket_mat_daily_active` | per day | `CONCURRENTLY` after every sync |
| `basket_mat_monthly_lifecycle` | per month | same |
| `basket_mat_team_monthly` | team × month | same |
| `basket_mat_revenue_daily` | day × currency × country × platform | same |
| `basket_mat_fixture_ranges` | league × country | same — derived from `basket_fixture_matches` JOIN `basket_content` JOIN `basket_tournaments` |

Each has a `CREATE UNIQUE INDEX` so `REFRESH CONCURRENTLY` does not block reads.

### `basket_mat_fixture_ranges` league naming
- League = `basket_tournaments.name` (Spanish) when content row exists for the fixture's match ID.
- Falls back to `source_sheet` slug (e.g. `fixture_nbb_br`) when no content row → unmatched. Resolves on next content sync.
- **Implication:** narrow `SYNC_CONTENT_WINDOW_DAYS` (default 30) leaves older fixtures unmatched. Set to ≥365 for full mapping.

---

## Generic sheet row store

Table `basket_sheet_rows (sheet TEXT, row_key TEXT, data JSONB, synced_at)`, composite PK.

**Used for:**
- `incidents` — Incidencias tab. `row_key = data.ID`.
- `grilla_<month_slug>` — one logical sheet per month tab (e.g. `grilla_mayo_26`). `row_key = data.ID`.

Auto-discovery: scan workbook tabs, match `/^(Enero|Febrero|...|Diciembre)\s+\d{2,4}$/i` regex.

**Dedup rule:** when sheet has duplicate `ID` values within batch, last-write-wins (Map-based dedup in `LoadSheetUseCase` and `LoadFixturesFromSheetUseCase`).

---

## Fixture sheets (per-league)

Discovery: env vars per league:
- `GOOGLE_SHEETS_FIXTURE_<LABEL>_ID` — workbook id (required)
- `GOOGLE_SHEETS_FIXTURE_<LABEL>_TAB` — single tab, OR
- `GOOGLE_SHEETS_FIXTURE_<LABEL>_TABS` — comma-separated multi-tab list (e.g. Uruguay has `Fixture LUB 25/26,Fixture LUB FEM 25/26`)

Logical slug:
- Single-tab: `fixture_<label_lowercase>` (e.g. `fixture_lnb_ar`).
- Multi-tab: `fixture_<label_lowercase>_<tab_slug>` (e.g. `fixture_lub_uy_fixture_lub_fem_25_26`).

Season-start year auto-parsed from tab name regex `(\d{2,4})\/\d{2,4}` (e.g. `Fixture NBB 25/26` → 2025). Used for date parsing when row date lacks year.

### Column variants
Three known shapes — mapper handles all via priority-ordered key fallbacks:

| LNB AR | NBB BR | LUB UY |
|---|---|---|
| DÍA(weekday), **FECHA**(date), HORA, LOCAL, VISITANTE, **TV**, ID, ESTADIO, CAMBIOS, ORIGINAL, ACLARACION, ULTIMA_ACTUALIZACION | N°, **FECHA**(date), DÍA(weekday), HORA, LOCAL, VISITANTE, ESTADIO, **TRANSMISIÓN**, BP, TELEMUNDO, ID | FECHA(matchday-num), **DIA**(date), INICIO TRANS, **INICIO PARTIDO**, LOCAL, VISITANTE, TV, ID |

### Mapped fields
| Sheet col(s) — first parseable/non-empty | DB col |
|-------------|--------|
| `ID` ‖ `id` | `id` (PK, integer) |
| `FECHA` ‖ `DIA` (tries each, picks first that parses as date) | `match_date` (UTC midnight) |
| `HORA` ‖ `INICIO PARTIDO` ‖ `INICIO TRANS` | `match_time` (text) |
| `LOCAL` | `home_team` |
| `VISITANTE` | `away_team` |
| `ESTADIO` | `venue` |
| `TV` ‖ `TRANSMISIÓN` ‖ `TRANSMISION` ‖ `Transmisión` | `broadcaster` |

### Date parsing
- Formats: `dd/mm/yyyy`, `d/m/yyyy`, `dd/mm/yy`, `d/m` (no year).
- Two-digit year auto-prefixed `20`.
- Missing year: infer from `seasonStartYear` + month heuristic (month ≥ 8 → `seasonStartYear`, else `seasonStartYear + 1`).
- LNB `DIA` column is weekday text (`miércoles`) — fails date regex, mapper falls through to `FECHA`.
- LUB `FECHA` column is matchday number (`1`, `FINAL J1`) — fails date regex, falls through to `DIA`.
- Stored as UTC midnight. Source has no timezone; treat as wall-clock match date.

---

## Subscription lifecycle metrics

| Metric | Definition |
|--------|------------|
| `new_payers` (month M) | users whose first `status=1` payment falls in M |
| `renewals` (month M) | active users in M who were also active in M-1 |
| `reactivations` (month M) | active users in M who were inactive in M-1 (but had prior history) |
| `expirations` (month M) | users active end of M-1 but inactive end of M |
| `churn_rate_pct` | `expirations / active_start * 100` |
| `retention_rate_pct` | `100 - churn_rate_pct` |

---

## Dashboard data consumption map

Authoritative source: `data/basket_dashboard_29.html` embedded `DATA.*`.

| `DATA.*` key | Backed by |
|---|---|
| `daily_active_*`, `daily_payments_*`, `daily_rev*` | users + payments |
| `monthly_*`, `period_aggs_*` | users + payments |
| `league_phase_ranges`, `competition_phases`, `country_phases`, `league_seasons`, `canonical_leagues_list` | derived from `basket_fixture_matches` + `basket_content` + `basket_tournaments` via `basket_mat_fixture_ranges` |
| `data_quality`, `fixture_quality` | derived from `basket_payments` + `basket_users` + `basket_fixture_matches` |

**Not currently consumed by dashboard:** Incidencias, Grilla rows (operational data only).

---

## Currency

- Stored uppercase, max 10 chars.
- Multi-currency: payments aggregated **per currency** in `basket_mat_revenue_daily` (no FX conversion).

---

## Country handling

- `basket_users.country` — user's country (self-reported).
- `basket_payments.payment_country` — billing country (may differ from user country).
- `basket_teams.country` — team's home country.
- `basket_tournaments.country` — tournament's organizing country.

When viewing "active users by country", uses `basket_users.country`.

---

## Idempotency

Every sync stage is idempotent via `ON CONFLICT (id) DO UPDATE`. Re-running same data ⇒ zero row delta.

`basket_sync_state` tracks `last_sync` + `row_count` per source. Updated only on stage success.

---

## Failure isolation

Each sync stage runs independently. A failure in stage N does not roll back N-1.
- **CSV stages** (tournaments, teams, users, content): failure aborts whole run.
- **Sheet stages** (incidents, grilla, fixtures): failures logged + reported in `RunSyncResult.syncedSheets[].inserted = -1`, but other sheets continue.

---

## Out-of-scope / deferred

- Live `/events_playing` ingestion.
- Live `/payments` (token scope).
- Phase / playoff boundary detection in fixture sheets (sheets don't expose phase; current ranges are single `'regular'` per league/season).
- Auth on GET API routes.
- FX conversion to common currency.
