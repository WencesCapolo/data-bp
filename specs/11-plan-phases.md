# Production Deployment Gaps

## Phase A · Code completeness (must-fix before ship)

- ~~Phase 7 polish~~ → **done**.
  - ~~URL ↔ filter state sync~~ → `src/lib/client/UrlFilterSync.tsx`.
  - ~~Error boundary per tab~~ → `src/components/ui/TabBoundary.tsx` wraps every tab.
  - ~~`ChartSkeleton` / `KpiGridSkeleton` / `TabSkeleton` primitives~~ → `src/components/ui/Skeleton.tsx`.
  - ~~`inFlight=true` louder in Header~~ → accent border + animated sweep bar (`.header.in-flight`).
  - ~~Smoke perf: `evolution?range=all` < 500 ms~~ → `pnpm smoke:perf` (`scripts/smoke-perf.ts`).
- ~~Auth on GET routes~~ → **done**. `src/middleware.ts` checks better-auth session cookie on `/basket/*` and `/api/basket/*`; redirects pages to `/sign-in`, returns 401 for API. `/api/basket/sync` allows `x-sync-token` bypass for cron.
- ~~Cache-Control / ETag on `/meta`~~ → done via `okCached` (`src/lib/api/responses.ts`). Stable reads beyond `/meta` deferred (filtered routes change too often to benefit).
- ~~Filter push-down to SQL across all routes~~ → done. `buildActiveFilterWhere` in `DrizzleAnalyticsQueryRepository` applies `countries[]` / `accessType` / `subType` for Overview / Evolution / Teams / Finance.
- ~~Phase 8.3b~~ → **deferred**. JSONB rows in `basket_sheet_rows` sufficient until a UI surface needs structured columns.

## Phase B · Secrets + config

- Move `.env` → secret manager (Vault / Doppler / hosted secrets). Never commit.
- Rotate `BP_TOKEN`, `SYNC_TOKEN`, Google service-account JSON.
- Production `DATABASE_URL` (hosted PG 16 — Neon/Supabase/RDS).
- `NODE_ENV=production` set (gates cron start in `layout.tsx`).
- Service-account JSON mount strategy (file vs env-encoded).

## Phase C · Database — **done** (private VPS, podman + Postgres 16)

- ~~Provision PG 16 + pool~~ → `docker-compose.prod.yml` (PG 16 alpine, bound `127.0.0.1:5432`, tuned for 1 GB RAM VPS: `max_connections=50`, `shared_buffers=256MB`, `effective_cache_size=768MB`, `wal_compression=on`, slow-query log at 500ms).
- ~~Connection pool sizing~~ → `src/shared/db/client.ts` now reads `DB_POOL_MAX` (default 10), `DB_IDLE_TIMEOUT_S`, `DB_CONNECT_TIMEOUT_S`. Single Next.js process × 10 = 10 connections, well under PG's 50.
- ~~Run migrations 0001-0005~~ → `pnpm db:bootstrap` (`scripts/db-bootstrap.sh`) runs drizzle migrate → apply-views → raw SQL 0002-0005 → initial-load → refresh-views → verify. Idempotent.
- ~~Verify unique indexes on all 5 mat views~~ → `pnpm db:verify` (`scripts/db-verify.ts`) confirms PG ≥16, core tables exist, every mat view has a `CREATE UNIQUE INDEX` (required for `REFRESH CONCURRENTLY`), prints row counts.
- ~~Initial backfill~~ → existing `pnpm sync:initial`, invoked by bootstrap.
- ~~Backup policy~~ → **manual only**. PG is the system of record but every table is re-derivable from upstream (Basket.tv API + Google Sheets) via `pnpm sync:initial`. `pnpm db:backup` (`scripts/db-backup.sh`) available for one-shot dumps before risky schema changes; no automated timer.

## Phase D · Hosting + runtime

- Pick host: VPS/EC2/Fly/Render (needs long-lived process for `node-cron`) OR Vercel + Vercel Cron calling `POST /api/basket/sync`.
- Containerize: `Dockerfile` for Next.js standalone build + multi-stage.
- Reverse proxy (Caddy/Nginx) + TLS (Let's Encrypt).
- Health endpoint (`/api/health`) — add. Not present.
- Process supervisor (systemd / container restart policy).
- Resource sizing: 1 vCPU / 1 GB minimum; mat-view refresh peaks RAM.

## Phase E · CI/CD

- GitHub Actions: `pnpm lint` + `pnpm build` on PR.
- Build → push container → deploy step.
- Pre-deploy migration runner (`pnpm views:apply` + `db:migrate`).
- Smoke after deploy: `pnpm smoke:api` against prod URL.
- Rollback strategy (previous container tag + DB additive-only safe).

## Phase F · Observability

- Structured logging (pino) → log aggregator (Loki/Datadog/CloudWatch).
- Error tracking: Sentry on Next.js (client + server).
- Sync metrics: duration per stage, row counts, failures. Currently only `console.error`.
- Uptime probe on `/api/basket/sync` GET.
- DB metrics: mat-view refresh time, query p95.
- Alerts: sync age > 36h (matches DataQualityTab red), 5xx spike, DB connection saturation.

## Phase G · Security

- HTTPS-only (HSTS).
- Rate-limit `/api/basket/sync` POST (token + IP).
- CORS lock-down (currently no explicit policy).
- Security headers: CSP, X-Frame-Options, Referrer-Policy.
- Dependency audit: `pnpm audit` clean.
- Secret scanning in CI (gitleaks).
- Postgres role least-privilege (app role ≠ owner).

## Phase H · Testing

- Vitest setup (chosen in `10-conventions.md`, not installed).
- Unit tests for use-cases (pure, mock ports).
- Smoke tests in CI against ephemeral PG container.
- Cross-check KPI vs `data/basket_dashboard_29.html` automated.

## Phase I · Ops runbook

- Doc: how to trigger manual sync (`curl -X POST -H x-sync-token …`).
- Doc: how to refresh views manually if sync partial-fails.
- Doc: how to add new league (env var pattern).
- Onboarding: who has access to BP token / Sheets service account.
- Incident playbook: stale data, sync stuck, mat-view bloat.

## Phase J · Legal / compliance

- PII inventory: `basket_users.email` + `firstname/lastname` stored. GDPR/local-law posture.
- Retention policy on `basket_payments` raw.
- Access log of who queries dashboard (audit trail).

---

**Critical path to MVP-prod**: A (Phase 7 + auth) → B (secrets) → C (DB) → D (host + TLS) → F-minimal (Sentry + uptime). Rest can ship iteratively post-launch.
