# 06 · API Routes (BFF)

All routes under `/api/basket/*`. Pattern: **BFF** (Backend-For-Frontend) — endpoint returns the **exact DTO** the tab needs, no client-side reshaping. SQL does the heavy lifting via mat views.

## Conventions

- `export const runtime = 'nodejs'`
- `export const dynamic = 'force-dynamic'`
- `Cache-Control: no-store` (sync cadence makes staleness undesirable)
- Auth: **none** on GETs (deferred Phase 7). `POST /sync` guarded by `x-sync-token` header == env `SYNC_TOKEN`.
- Validation: Zod via `src/lib/api/zodSchemas.ts`. Errors → 400 JSON `{ error:'invalid_query', issues: [...] }`.
- Errors: 500 JSON `{ error:'internal_error', message, stack? }` (stack only in non-prod).
- Composition: `composeRepo()` returns a single `DrizzleAnalyticsQueryRepository` instance.

## Route handler skeleton (~25 LOC each)

```ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const parsed = OverviewQuerySchema.safeParse(parseSearchParams(req));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    const dto = await new GetOverviewUseCase(composeRepo()).execute(
      parsed.data.asOf ? new Date(parsed.data.asOf) : undefined,
      parsed.data.filters,
    );
    return ok(dto);
  } catch (err) { return serverError(err); }
}
```

## Routes

| Route | Method | Params | Use-case | DTO |
|---|---|---|---|---|
| `/api/basket/meta` | GET | — | `GetMetaUseCase` | `MetaDTO` |
| `/api/basket/overview` | GET | `asOf?`, `countries[]`, `accessType?`, `subType?` | `GetOverviewUseCase` | `OverviewDTO` |
| `/api/basket/evolution` | GET | `range`, `from?`, `to?`, `granularity`, common filters | `GetEvolutionUseCase` | `EvolutionDTO` |
| `/api/basket/teams` | GET | `range`, `limit (1–500)`, `country?`, common filters | `GetTeamsUseCase.execute` | `TeamsDTO` |
| `/api/basket/teams/[teamId]/trend` | GET | path `teamId` | `GetTeamsUseCase.trend` | `TeamTrendDTO` |
| `/api/basket/finance` | GET | `range`, `from?`, `to?`, common filters | `GetFinanceUseCase` | `FinanceDTO` |
| `/api/basket/retention` | GET | — | `GetRetentionUseCase` | `RetentionDTO` |
| `/api/basket/data-quality` | GET | — | `GetDataQualityUseCase` | `DataQualityDTO` |
| `/api/basket/sync` | GET | — | `DrizzleSyncStateRepository.findAll()` | `{ sources, inFlight }` |
| `/api/basket/sync` | POST | header `x-sync-token` | `composeRunSync().execute()` | `RunSyncResult` |

### Common filter shape

Query params (repeated key for arrays):
```
countries=Uruguay&countries=Argentina   → string[]
accessType=real | voucher | antel
subType=Free | Mensual_Basico | Mensual_Total | Anual_Total | Otros
```

### Date range shape

```
range=30d | 90d | ytd | all | custom
from=YYYY-MM-DD (required if range=custom)
to=YYYY-MM-DD   (required if range=custom)
```

Zod `customRangeRefine` enforces from+to when range=custom.

## DTO shapes (summary)

### `MetaDTO`
```
{
  dataRange:  { minDay, maxDay },
  countries:  string[],            // desc by user count
  enums:      { subTypes, accessTypes, platforms, granularity, ranges }
}
```
Static enum lists exported from `core/dtos/MetaDTO.ts` (`META_ENUMS`).

### `OverviewDTO`
```
{
  asOf:               'YYYY-MM-DD',
  kpis: {
    activeAll, activeReal, activeVoucher, activeAntel,
    activeFree, activeMensualBasico, activeMensualTotal, activeAnualTotal,
    newPayersLast30d,
    revenueLast30dByCurrency: { currency, amount }[]
  },
  trend30d:           { day, allActive, realActive, voucherActive }[],
  accessBreakdown:    { label, count, pct }[],
  subTypeBreakdown:   { label, count, pct }[],
  countryBreakdown:   { label, count, pct }[],
}
```

### `EvolutionDTO`
```
{
  range, granularity,
  series: { bucket, allActive, realActive, voucherActive,
            freeActive, mensualBasicoActive, mensualTotalActive, anualTotalActive }[]
}
```

### `RetentionDTO`
```
{
  rows: { month, activeStart, activeEnd, newPayers, renewals, reactivations,
          expirations, churnRatePct, retentionRatePct }[],
  latestChurnRatePct, latestRetentionRatePct
}
```

### `FinanceDTO`
```
{
  range,
  revenueByDay:    { day, currency, totalAmount, realAmount, paymentCount }[],
  byPlatform:      { platform, platformName, paymentCount, totalAmount, realCount, realAmount }[],
  byCurrency:      { currency, totalAmount, paymentCount }[],
  platformMonthly: { month, platformName, totalAmount }[]
}
```

### `TeamsDTO`
```
{
  range,
  totals: { teams, uniquePayers, totalPayments },
  ranked: { teamId, teamName, league, teamCountry,
            uniquePayers, totalPayments, totalAmount,
            realPayers, voucherPayers }[]
}
```

### `TeamTrendDTO`
```
{ teamId, teamName, points: { month, uniquePayers, totalAmount }[] }
```

### `DataQualityDTO`
```
{
  generatedAt,
  issues:  { code, description, count }[],
  totals:  { users, payments, teams }
}
```

Known issue codes (extensible): `payment_orphan`, `paid_zero_non_antel`, `user_no_country`, `user_unknown_team`, ...

## POST /sync mechanics

- In-memory `inFlight` lock — second concurrent request returns **409**.
- Returns `RunSyncResult` JSON on success (see [05-sync-pipeline.md](05-sync-pipeline.md)).
- On `SYNC_TOKEN` mismatch → **401**.

## Verification

```bash
pnpm dev                          # boot server
for ep in meta overview evolution teams finance retention data-quality sync; do
  curl -s -o /dev/null -w "$ep %{http_code}\n" "http://localhost:3000/api/basket/$ep"
done
pnpm smoke:api                    # full Zod round-trip
```

Performance target: each route < 200 ms (mat view query < 130 ms + ~50 ms Next.js overhead).

## Out of scope (this phase)

- ETag / 304 / Cache-Control tuning → Phase 7.
- Auth on GETs → Phase 7.
- `countries[]` + `accessType` + `subType` push-down into the underlying SQL across all routes — current support is partial (`getTeams` has `country` single string; Overview filters applied in-process). Full filter push-down in Phase 6 follow-up.
