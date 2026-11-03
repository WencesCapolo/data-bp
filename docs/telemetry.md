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

**From the server** (`src/lib/telemetry.ts`): `reportServerError(err, context)`, `trackServerEvent(name, userId, props)` and `flush()`. They queue items and POST them in one batch per second to `TELEMETRY_INGEST_URL` (`v: 1`, `events`, `errors`; SPEC §6.2), with a 1.5 s timeout. It never throws and nothing awaits it. `context` holds the method, the route pattern or job name, `routeType`, `status` and a `step`; an Analyst's Better Auth id goes in it as `userId` and is sent as the error's `userId`, not as context. Error messages are scrubbed before they leave (`scrubMessage`, `src/lib/scrub.ts`): it cuts DB errors at `params:` and masks emails, quoted values, JSON objects and numbers, amounts included, so no payment data reaches the ingest; the stack keeps only its frames.

`src/instrumentation.ts`:

- `onRequestError` reports every error Next catches in pages, route handlers and the proxy, with `{ method, route, routeType }`.
- `register()` (Node runtime only) loads `src/lib/telemetry-shutdown.ts`, which calls `flush()` on `SIGTERM`/`SIGINT` so a restart does not drop the last second of the queue.

### Errors caught before Next sees them

A handler that catches an error itself answers on its own, so `onRequestError` never runs. Those sites report through `reportUnexpected(tag, err, context)` (`src/lib/reportError.ts`): one log line through `logError` and one report. `logError(tag, err, extra?)` (`src/lib/logError.ts`) prints `[tag] Type: scrubbed message {extra}`, never the error object; client code (`TabBoundary`) uses it to log only.

| where | `context` |
|---|---|
| `serverError(err, { method, route })` (`src/lib/api/responses.ts`), in every API route's catch; answers `{ error: 'internal_error' }` (500), with the stack only outside production | `{ method, route: '/api/…', routeType: 'route', status: 500 }` |
| `POST /api/sync`: a failed Pagos Upload run, the partidos sync it starts, the steps a successful run survived without | `{ routeType: 'job', route: 'payments-sync' \| 'partidos-sync', step? }` |
| `POST /api/partidos/sync` (through `serverError`) | `{ method: 'POST', route: 'partidos-sync', routeType: 'job', status: 500 }` |
| `POST /api/basket/sync` | `{ routeType: 'job', route: 'basket-sync', step? }` |
| `SyncScheduler` (the cron started from `src/app/layout.tsx`) | `{ routeType: 'job', route: 'sync-scheduler', step? }` |
| `DrizzleSyncRunRepository.record` (a sync run not logged) | `{ routeType: 'adapter', route: 'sync-run-log', step: 'record' }` |
| `DrizzleUploadLookups` (the Upload preview's lookups; still answer `null`) | `{ routeType: 'adapter', route: 'upload-lookups', step }` |
| the export inbox, a file that could not be moved to `done/` | `{ routeType: 'job', route: 'export-inbox', step: 'mark-done' }` |
| `src/app/actions/access-requests.ts` and the bell (`SolicitudesDeAcceso.tsx`) | `{ routeType: 'action' \| 'render', route: 'access-requests', step, userId? }` |

A step the sync survives (`RunSyncResult.failedSteps`) is reported as a `SyncStepError` with its `step`; the item (a sheet, a gateway) stays in the sync log. A table that predates its migration (`42P01`, `src/shared/db/pgErrors.ts`) is expected and not reported.

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
    N->>N: logError (one scrubbed line) + reportServerError (queued)
    N-->>B: 500 { error: 'internal_error' }
  else Next catches it
    N->>N: onRequestError → reportServerError (queued)
    N-->>B: error response / error.tsx
  end
  N->>T: POST /ingest/server (batch ≤ 1 s, Bearer TELEMETRY_TOKEN; flushed on SIGTERM/SIGINT)
  B->>B: error.tsx, global-error.tsx or TabBoundary → window.bpt.captureError
  B->>T: POST /_t/e via nginx /_t/ (batched, sendBeacon on pagehide)
  T->>T: fingerprint, group, GitHub issue in WencesCapolo/data-bp
```
