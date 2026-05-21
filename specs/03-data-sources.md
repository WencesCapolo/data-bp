# 03 · Data Sources

Three ingestion families. Every source has an env var, a port interface in `core/ports/`, and a Drizzle adapter in `infrastructure/`.

## Family 1 — External CSV API (BP backend)

Resource paths under `EXTERNAL_API_BASE`. Auth via query param `?token=<BP_TOKEN>` (NOT Bearer header — Bearer returns 403).

| Resource | Env path var | Status | Notes |
|---|---|---|---|
| `users` | `EXTERNAL_USERS_PATH` | ✅ live | streamed, semicolon-CSV, BOM-handled |
| `payments` | `EXTERNAL_PAYMENTS_PATH` | ❌ token 403 | falls back to local CSV (`scripts/initial-load.ts`), set `SYNC_PAYMENTS_ENABLED=false` |
| `teams` | `EXTERNAL_TEAMS_PATH` | ✅ live | only `id,name,country` — local DB merges with curated `league/tier/type` |
| `tournaments` | `EXTERNAL_TOURNAMENTS_PATH` | ✅ live | name + country only |
| `content` | (default `content`) | ✅ live | windowed via `from/to` query params, default 30 days (`SYNC_CONTENT_WINDOW_DAYS`) |
| `events_playing` | — | ⏳ deferred | large, hourly cadence TBD |

### CSV format

- Delimiter: `;` (semicolon)
- Encoding: UTF-8 with BOM
- Parser: `csv-parse` streaming, configured in `CsvApiFetcher`

### Node 24 IPv6 quirk

`undici` (Node 24's fetch) tries IPv6 first → `ENETUNREACH` on hosts without v6 → falls back v4 → can `ETIMEDOUT`. `CsvApiFetcher` uses `node:https.request` with `new Agent({ family: 4, keepAlive: true })`.

### `BP_TOKEN` probe results

Verified via 4-variant probe:
- Bearer header → 403
- Cookie → 403
- No auth → 403
- `?token=…` → 200 ✅

Same token works for `users`/`teams`/`tournaments`/`content`. **403 on `/payments`** → scope insufficient. Payments stays on local CSV.

## Family 2 — Google Sheets (operational sheets)

Auth: service account JWT (`GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_KEY`). Scope `spreadsheets.readonly`.

`GoogleSheetsFetcher` exposes 3 methods:
- `listTabs(id)` — for auto-discovery
- `fetchRows(id, tab)` — returns row-object array (header-keyed)
- `getValues(id, tab)` — returns raw `string[][]` grid (used for DATA tabs)

### Single-tab workbooks (rows go to `basket_sheet_rows` JSONB)

| Env var | Logical sheet | Use |
|---|---|---|
| `GOOGLE_SHEETS_ID_INCIDENCIAS` (+ `_TAB_INCIDENCIAS`) | `incidents` | Operational issues per match |
| `GOOGLE_SHEETS_ID_GRILLA` | `grilla_<month_slug>` (multi-tab, auto-discovered) | Monthly broadcast schedule. Tab regex `/^(Enero\|...\|Diciembre)\s+\d{2,4}$/i` |
| `GOOGLE_SHEETS_ID_TOTAL_PARTIDOS` | ⏳ not wired | Future: aggregate totals |

`row_key = data.ID`. Map-based dedup within batch (last-write-wins).

### Fixture workbooks (rows go to `basket_fixture_matches`)

Discovery scans env for `GOOGLE_SHEETS_FIXTURE_<LABEL>_ID`. Pairs with `_TAB` (single) or `_TABS` (comma-sep multi).

Current workbooks (7 with DATA tabs, 1 without):

| Label | Country / League | Tab var | DATA tab |
|---|---|---|---|
| `LNB_AR` | Argentina · Liga Nacional | `_TAB` | ❌ (no DATA tab) |
| `NBB_BR` | Brasil · NBB | `_TAB` | ✅ |
| `LUB_UY` | Uruguay · LUB + LUB Fem | `_TABS` (2 tabs) | ✅ |
| `ACB_ES` | España · ACB | `_TAB` | ✅ |
| `LIGAU_ES` | España · Liga U | `_TAB` | ✅ |
| `FEB_ES` | España · FEB | `_TAB` | (?) |
| `LBA_IT` | Italia · LBA | `_TAB` | ✅ (uses header `NOMBRE OFICIAL`) |
| `CL` | Chile (multi-tab) | `_TABS` | ✅ |
| `LF_EC` | Ecuador · Liga Femenina | `_TAB` | ✅ |

### Logical slugging

- Single-tab: `fixture_<label_lowercase>` → e.g. `fixture_lnb_ar`
- Multi-tab: `fixture_<label_lowercase>_<tab_slug>` → e.g. `fixture_lub_uy_fixture_lub_fem_25_26`

### Season-start year auto-parse

From tab title regex `(\d{2,4})\/\d{2,4}` → e.g. `Fixture NBB 25/26` → 2025. Used for date parsing when row date lacks year.

### Fixture column variants (3 known shapes)

Mapper `fixtureMappers.ts` handles all via priority-ordered key fallbacks:

| LNB AR | NBB BR | LUB UY |
|---|---|---|
| DÍA(weekday), **FECHA**(date), HORA, LOCAL, VISITANTE, **TV**, ID, ESTADIO, CAMBIOS, ORIGINAL, ACLARACION, ULTIMA_ACTUALIZACION | N°, **FECHA**(date), DÍA(weekday), HORA, LOCAL, VISITANTE, ESTADIO, **TRANSMISIÓN**, BP, TELEMUNDO, ID | FECHA(matchday-num), **DIA**(date), INICIO TRANS, **INICIO PARTIDO**, LOCAL, VISITANTE, TV, ID |

Mapped fields (first parseable wins):

| Sheet cols (priority) | DB column |
|---|---|
| `ID` ‖ `id` | `id` (PK, integer) |
| `FECHA` ‖ `DIA` | `match_date` (UTC midnight) |
| `HORA` ‖ `INICIO PARTIDO` ‖ `INICIO TRANS` | `match_time` (text) |
| `LOCAL` | `home_team` |
| `VISITANTE` | `away_team` |
| `ESTADIO` | `venue` |
| `TV` ‖ `TRANSMISIÓN` ‖ `TRANSMISION` ‖ `Transmisión` | `broadcaster` |

### Date parsing

- Accepts `dd/mm/yyyy`, `d/m/yyyy`, `dd/mm/yy`, `d/m` (no year).
- 2-digit year auto-prefixed `20`.
- Missing year inferred from `seasonStartYear` + month heuristic (month ≥ 8 → `seasonStartYear`, else `+1`).
- LNB `DIA` (weekday text) fails date regex → mapper falls through to `FECHA`. Same trick for LUB `FECHA` (matchday number).
- Stored UTC midnight. No source timezone → wall-clock match date.

### Fixture rows without ID

Either (a) BP won't work with that match, or (b) BP will but hasn't entered it yet. Mapper returns `null` → row skipped. `basket_fixture_matches` only contains BP-tracked matches.

## Family 3 — Google Sheets DATA tabs (per-workbook master data)

Each fixture workbook ships a `DATA` tab. Layout = multi-column-block: several independent vertical lists side-by-side with different lengths. Headers in row 1 (or near top).

### Column-role classifier (`sheetDataMapper.ts`)

Normalize header (lowercase, strip diacritics, trim) → role:

| Header (normalized) | Role |
|---|---|
| `equipos`, `equipo`, `nombre completo`, `nombre oficial` | `team_name` |
| `nombre corto` | `team_short` |
| `siglas` | `team_siglas` |
| `estadio`, `estadios` | `team_stadium` |
| `ciudad` | `team_city` |
| `pagina oficial` | `team_page` |
| `cambios` | `cambios` |
| `dias`, `dia` | `dias` |

Header row found by scanning first 5 rows for the highest header-keyword density.

### Three independent lists per workbook

- **Teams** → `basket_team_master` (PK: workbook_label + name_full)
- **Cambios** (changes/substitutions taxonomy) → `basket_cambios_enum` (PK: workbook_label + label)
- **Días** (matchday labels) → `basket_dias_enum` (PK: workbook_label + label)

Each list deduped per role within the parse (Set-backed). Enums get an incremental `position` for ordering.

### Verified counts (last sync)

136 teams across 7 workbooks (ACB, CL, LBA, LF_EC, LIGAU, LUB, NBB). LNB_AR skipped cleanly (no DATA tab). LBA fixed after adding `nombre oficial` to classifier.

## Env-var conventions

```
EXTERNAL_API_BASE=                  https://api.example.com
EXTERNAL_API_KEY= / BP_TOKEN=       (BP_TOKEN sent as ?token=)
SYNC_PAYMENTS_ENABLED=false         disables /payments stage
SYNC_CONTENT_WINDOW_DAYS=30         content lookback window
SYNC_CONTENT_ENABLED=true|false
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_KEY=         (\n-escaped private key)
GOOGLE_SHEETS_ID_GRILLA=            multi-tab month workbook
GOOGLE_SHEETS_ID_INCIDENCIAS=       single-tab
GOOGLE_SHEETS_FIXTURE_<LABEL>_ID=   one per league
GOOGLE_SHEETS_FIXTURE_<LABEL>_TAB=  single-tab
GOOGLE_SHEETS_FIXTURE_<LABEL>_TABS= comma-sep multi-tab (e.g. Uruguay, Chile)
SYNC_TOKEN=                         guards POST /api/basket/sync (x-sync-token header)
SYNC_INTERVAL_HOURS=                cron cadence (default 6)
```
