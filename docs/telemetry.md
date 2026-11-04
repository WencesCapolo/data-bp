# Telemetry

Analytics reports to [basket-telemetry](https://github.com/WencesCapolo/basket-telemetry), the superadmin panel at `server.basket-app.com` (app key `analytics`). How every app integrates, the `window.bpt` API and the privacy rules: [basket-telemetry docs/sdk.md](https://github.com/WencesCapolo/basket-telemetry/blob/main/docs/sdk.md).

Everything is a no-op until the telemetry service and the env below exist: the SDK turns itself off when `/_t/config` does not answer, and the server reporter sends nothing without `TELEMETRY_TOKEN`.

## What the app sends

**From the browser** (the SDK, `/_t/sdk.js`, same-origin through nginx's `/_t/` proxy): pageviews, heartbeats (active time), clicks, rage/dead clicks, uncaught errors, and PostHog session replay (loaded by the SDK itself; analytics has `replay: yes`). The user is identified server-side from the Better Auth cookie; the app sends no user id.

- `src/app/layout.tsx`: the queueing stub (`window.bpt` before the SDK loads) and `<Script src="/_t/sdk.js" strategy="afterInteractive" />`.
- `src/app/error.tsx` and `src/app/global-error.tsx`: render `src/components/ui/ErrorScreen.tsx` (Spanish fallback) and call `window.bpt?.captureError(error, { boundary, digest })`.
- `src/components/ui/TabBoundary.tsx`: a tab that fails to render is reported with `{ boundary: 'tab' }`.
- `src/types/bpt.d.ts`: the `window.bpt` types, copied from basket-telemetry `src/sdk/sdk.d.ts`.
- Browser source maps are emitted (`productionBrowserSourceMaps`) so basket-telemetry resolves browser stacks; nginx denies `*.map` to the public.

**From the server**: the [basket-tv-telemetry](https://github.com/WencesCapolo/basket-tv-telemetry) package, installed by git tag (`package.json`). `src/lib/telemetry.ts` creates the reporter for this app (`telemetry.reportServerError`, `telemetry.trackServerEvent`, `telemetry.flush`) and holds the sync's wide-event helpers. The reporter batches once per second, never throws, and scrubs every message before it leaves (`scrubMessage`: cut at `params:`, emails, quoted values, JSON objects and numbers masked, amounts included); the stack keeps only its frames. The package's fixtures are the scrubbing rules. `src/modules/*/core/**` never imports the package: use cases return what happened and the adapters and routes put it on the log line.

`src/instrumentation.ts`:

- `onRequestError` reports every error Next catches in pages, route handlers and the proxy, with `{ method, route, route_type, request_id }`; `request_id` links the report to the request's log line.
- `register()` (Node runtime only) loads `src/lib/telemetry-shutdown.ts`, which calls `telemetry.flush()` on `SIGTERM`/`SIGINT` so a restart does not drop the last second of the queue. Best effort: under `next start`, Next's own handler closes the server and exits, possibly before the request completes.

## Server logs

One JSON line per unit of work on stdout, in the format of basket-telemetry `docs/sdk.md` ("Server logs"). Nothing in `src/` calls `console.*`.

| line | where | fields beyond the core ones |
|---|---|---|
| `kind: "request"` | every `src/app/api/**/route.ts` handler, through `withRequestLog` | `user_id`, `role` (`getSessionUser`), `reason` (`unauthorized()`, `badRequest()`, an Upload rejection), `upload_id`, `source_id`, `row_total` on the Upload routes and `POST /api/sync` |
| `kind: "job"`, `route: "basket_sync"` | `runLoggedSync`: the scheduler (`trigger: "cron"`) and `POST /api/basket/sync` (`trigger: "token"`) | `steps: [{ name, ok, rows, error? }]`, `inbox_files`, `gateway_retries`, `skipped_gateways` |
| `kind: "job"`, `route: "payments_sync"` | `PagosUploadIntake.confirm`, from `POST /api/sync` (`trigger: "analyst"` or `"token"`) | `steps`, `upload_id`, `row_total` |
| `kind: "job"`, `route: "partidos_sync"` | `runPartidosSync`, from `POST /api/partidos/sync` and `POST /api/sync` | `steps` (`nacional`, `intl`) |
| `kind: "start"` | `SyncScheduler` | `cron` |

A sync started by a request writes its own job line with the request's `request_id`, so the two lines are found together. A step's `ok` is false when it threw or when a gateway, FX source or inbox file inside it failed; `error` is the first error it threw, `{ type, message }` with the message scrubbed. A step the run survives leaves the job's `outcome: "ok"`; a fatal step ends the run with `level: "error"`.

### Errors caught before Next sees them

A handler that catches an error itself answers on its own, so `onRequestError` never runs. Those sites call `reportCaughtError(err, context)` (`src/lib/telemetry.ts`): it marks the current line (`markError`; outside a request or job, one throttled line per `route` and `step`) and reports the error once.

| where | `context` |
|---|---|
| `serverError(err)` (`src/lib/api/responses.ts`), in every API route's catch; answers `{ error: 'internal_error' }` (500), with the stack only outside production | `{ route_type: 'route', status: 500 }` (method, route and request id come from the line) |
| a sync run that throws, or a failed Pagos Upload run (`runJob`) | `{ route_type: 'job' }` |
| each step error a sync survives (`recordJobStep`) | `{ route_type: 'job', step }` |
| `DrizzleSyncRunRepository.record` (a sync run not logged) | `{ route_type: 'adapter', route: 'sync-run-log', step: 'record' }` |
| `DrizzleUploadLookups` (the Upload preview's lookups; still answer `null`) | `{ route_type: 'adapter', route: 'upload-lookups', step }` |
| the export inbox, a provenance row not written or a file that could not be moved to `done/` | `{ route_type: 'job', route: 'export-inbox', step: 'provenance' \| 'mark-done' }` |
| `PagosUploadIntake` / `FeeUploadIntake`: a provenance row not written, the gateway net views not refreshed | `{ route_type: 'adapter', route: 'pagos-upload' \| 'fee-upload', step: 'provenance' \| 'refresh-views' }` |
| `composeRunSync`: Sheets tabs that could not be listed | `{ route_type: 'job', route: 'sync-discovery', step: 'grilla-tabs' \| 'data-tabs' }` |
| `composeGatewayFeeSync`: a MercadoPago window over the 1000-row cap | `{ route_type: 'job', route: 'gateway-fee-sync', step: 'mercadopago-window', from, to, total }` |
| `src/app/actions/access-requests.ts` and the bell (`SolicitudesDeAcceso.tsx`) | `{ route_type: 'action' \| 'render', route: 'access-requests', step, userId? }` |

The sync state the endpoints answer (`lastError`, `lastResult` of `GET /api/sync`, `/api/basket/sync` and `/api/partidos/sync`) holds scrubbed text only: `scrubMessage` where `lastError` is set, `scrubErrorFields` over a stored result (every nested `error` string: failed steps, gateways, FX sources, inbox files), and `DrizzlePartidosSyncStateRepository` scrubs the error it stores. A table that predates its migration (`42P01`, `src/shared/db/pgErrors.ts`) is expected and not reported.

## Business events

Props are ids, counts and enums only: never emails, names, free text or amounts.

| event | where | props |
|---|---|---|
| `dashboard_viewed` | `src/app/(marco)/{basket,financiero,partidos}/page.tsx`, after `requireDashboard` | `dashboard` (`basket-subs`, `financiero`, `partidos`) |
| `payments_sync_started` | `src/app/api/sync/route.ts` POST, once the Pagos Upload confirm has started | `row_total` (what the browser echoed; `null` if not sent), `trigger` (`analyst` or `token`) |
| `fees_ingested` | `src/app/api/basket/fees/ingest/route.ts` POST, when the confirm is ok | `source_id` (the fee Export source id) |
| `partidos_synced` | `src/app/api/partidos/sync/route.ts` POST, after a successful sync | `count_nacional`, `count_intl`, `duration_ms` |
| `tab_switched` (client) | `src/components/ui/SegmentedTabs.tsx`, used by `TabBar.tsx` and the other dashboards' tab bars; only when the tab changes | `tab` (the tab key) |

`userId` is the Analyst's Better Auth id where there is one, `null` for the sync token and for `partidos_synced`.

## Env

| var | default | note |
|---|---|---|
| `TELEMETRY_INGEST_URL` | `http://127.0.0.1:3011/ingest/server` | localhost only, never through nginx |
| `TELEMETRY_TOKEN` | — | this app's token in basket-telemetry's `INGEST_TOKENS` (`analytics:<token>`). Unset: the server reporter is off. |

The pm2 env of `analytics` also needs `NODE_OPTIONS=--enable-source-maps`, so server stacks arrive resolved. The pm2 config is not in this repo: set it on the server.

## Error path

Browser and server errors of analytics reach basket-telemetry, which groups them and opens issues in this repo.

```mermaid
sequenceDiagram
  participant B as Browser (SDK)
  participant N as Next server (analytics)
  participant T as basket-telemetry :3011
  B->>N: request
  N-->>N: page / route throws
  alt the handler catches it (serverError, a sync)
    N->>N: the error on the request's or job's JSON line + reportServerError (queued)
    N-->>B: 500 { error: 'internal_error' }
  else Next catches it
    N->>N: the error on the request's JSON line; onRequestError → reportServerError with its request_id (queued)
    N-->>B: error response / error.tsx
  end
  N->>T: POST /ingest/server (batch ≤ 1 s, Bearer TELEMETRY_TOKEN; flushed on SIGTERM/SIGINT)
  B->>B: error.tsx, global-error.tsx or TabBoundary → window.bpt.captureError
  B->>T: POST /_t/e via nginx /_t/ (batched, sendBeacon on pagehide)
  T->>T: fingerprint, group, GitHub issue in WencesCapolo/data-bp
```
