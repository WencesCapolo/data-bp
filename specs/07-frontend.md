# 07 · Frontend

Next.js 16 App Router. React 19. TypeScript. Single page (`/basket`) with client-side tab routing.

## Top-level layout

```
src/app/
├── layout.tsx                  registers cron in prod
└── basket/
    └── page.tsx                'use client' — header + tabbar + filter row + active tab
```

`page.tsx` renders:
```
<Header />
<TabBar />
<main>
  <FilterRow ... />    (conditional, per tab)
  <{ActiveTab} />
</main>
```

Active tab from Zustand store (`useFilters((s) => s.tab)`). No URL sync (yet).

## State

### Zustand — `src/lib/client/filterStore.ts`

Single module-scoped store holds:
```ts
{
  tab:         'overview'|'evolution'|'teams'|'finance'|'retention'|'quality',
  range:       '30d'|'90d'|'ytd'|'all',
  countries:   string[],
  accessType?: 'real'|'voucher'|'antel',
  subType?:    'Free'|'Mensual_Basico'|'Mensual_Total'|'Anual_Total'|'Otros',
  granularity: 'day'|'week'|'month',
  setTab, setRange, setCountries, setAccessType, setSubType, setGranularity, resetFilters
}
```

Selectors used per-component to avoid render churn:
```ts
const range = useFilters((s) => s.range);
```

### SWR — data fetching

- One hook per tab; URL built from filter state.
- `OverviewTab` polls every 5 min (`refreshInterval: 300_000`).
- `Header` polls `/api/basket/sync` every 60 s for last-sync badge.
- `fetcher` in `src/lib/client/fetcher.ts` throws on non-2xx (surfaces error to SWR).

## Tabs

```
src/components/tabs/
├── OverviewTab.tsx
├── EvolutionTab.tsx
├── TeamsTab.tsx
├── TeamsRow.tsx        sortable row + drill-down trend (SWR child fetch)
├── FinanceTab.tsx
├── RetentionTab.tsx
├── DataQualityTab.tsx
└── StubTab.tsx         placeholder for unfinished tabs (none current)
```

Each tab:
1. Reads filter slice from Zustand.
2. Builds `URLSearchParams` → SWR hook → DTO.
3. Renders `kpi-grid`, `chart-full`, `col2`, `summary-card`, `alert-box` layout sections.
4. Has its own `Skeleton<Tab>()` + `ErrorBox` inline (no shared error boundary yet).

## UI primitives

```
src/components/ui/
├── KpiCard.tsx          { label, value, sub?, variant }
├── DatePills.tsx        30d / 90d / YTD / Todo
├── MultiSelect.tsx      country picker (uses meta.countries)
├── AccessPills.tsx      real / voucher / antel
├── SubtypePills.tsx     Free / Mensual_Basico / ...
├── GranularityToggle.tsx day / week / month
└── FilterRow.tsx        composes the above, props gate visibility per tab
```

`FilterRow` is the only consumer of `/api/basket/meta` for country options.

## Charts

```
src/components/charts/
├── ChartCanvas.tsx          'use client' base: Chart.js + canvas + cleanup
├── LineChart.tsx
├── BarChart.tsx
├── DoughnutChart.tsx
├── StackedBarChart.tsx
└── StackedAreaChart.tsx
```

Wrapping pattern: thin React components that build a `ChartConfiguration` and pass to `ChartCanvas`. Chart.js registered once globally in `chartjs-setup.ts` (imported by layout).

Tooltip + axis styling reused across charts (dark theme via CSS vars `--text`, `--text2`, `--text3`, `--accent`, etc.).

## Header

`Header.tsx`:
- Logo + subtitle.
- `sync-badge` with `dot` colored by age:
  - `< 12h` green
  - `12-36h` yellow
  - error if `inFlight` returns null
- Polls `GET /api/basket/sync` every 60 s.
- Shows ISO date.

## TabBar

`TabBar.tsx` — fixed labels:
```
Visión General
Evolución Histórica
Análisis por Equipo
Análisis Financiero
Retención / Churn
Calidad de Datos
```

Switching tabs updates Zustand `tab`; no router push.

## Filter visibility per tab

Set by `FilterRow` props in `page.tsx`:

| Tab | `range` | `granularity` | `countries` | `accessType` | `subType` |
|---|---|---|---|---|---|
| Overview | ✅ | — | ✅ | ✅ | ✅ |
| Evolution | ✅ | ✅ | ✅ | ✅ | ✅ |
| Teams | ✅ | — | ✅ | ✅ | ✅ |
| Finance | ✅ | — | ✅ | ✅ | ✅ |
| Retention | — | — | — | — | — |
| DataQuality | — | — | — | — | — |

Retention and DataQuality use whole-history aggregates only.

## Skeleton / error states

- Skeleton blocks (`<div className="skeleton" />`) sized to match expected chart heights — avoids layout jump.
- `<ErrorBox message={...} />` inline per tab, red-themed.
- No global error boundary yet (Phase 7).

## Styling

Single global stylesheet (`globals.css`) carried over from the legacy HTML — same CSS variables, same dark theme, same `.kpi-card`, `.chart-card`, `.data-table`, `.alert-box` classes. Tabs / charts match visual identity of the original dashboard.

## URL → search params building (consumer side)

Each tab has its own `buildUrl({...})` helper. Pattern duplicated rather than abstracted — keeps DTO shapes coupled to the route. If a tab needs different params (e.g. `teams` adds `limit`), it diverges without breaking siblings.

## Drill-down

`TeamsRow` opens a drill-down: collapses inline, fetches `/api/basket/teams/[teamId]/trend` lazily, renders a `LineChart` of `uniquePayers` + `totalAmount` per month.

## Phase 7 polish items (TODO)

- Loading skeletons unified per chart card (currently per tab).
- Error boundary per tab (instead of inline `ErrorBox`).
- URL sync of filter state (deep-linkable views).
- League band annotations on EvolutionTab (needs `mat_fixture_ranges` join).
