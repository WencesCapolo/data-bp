# Production Deployment Gaps

## Phase A · Code completeness (must-fix before ship)

- Phase 7 polish (from `09-development-plan.md`)
  - URL ↔ filter state sync (deep links)
  - Error boundary per tab (replace inline `ErrorBox`)
  - Unified `ChartSkeleton` primitives
  - `inFlight=true` louder in Header
  - Smoke perf: `evolution?range=all` < 500 ms
- Auth on GET routes — currently open. Cookie/session before public exposure.
- Cache-Control / ETag on `/meta` + stable reads.
- ~~Filter push-down to SQL across all routes~~ → done. `buildActiveFilterWhere` in `DrizzleAnalyticsQueryRepository` applies `countries[]` / `accessType` / `subType` for Overview / Evolution / Teams / Finance.
- ~~Phase 8.3b~~ → **deferred**. JSONB rows in `basket_sheet_rows` sufficient until a UI surface needs structured columns.

## Phase B · Secrets + config

- Move `.env` → secret manager (Vault / Doppler / hosted secrets). Never commit.
- Rotate `BP_TOKEN`, `SYNC_TOKEN`, Google service-account JSON.
- Production `DATABASE_URL` (hosted PG 16 — Neon/Supabase/RDS).
- `NODE_ENV=production` set (gates cron start in `layout.tsx`).
- Service-account JSON mount strategy (file vs env-encoded).

## Phase C · Database

- Provision PG 16 instance + connection pool (pgBouncer / built-in).
- Run `migrations/sql/0001–0004` against prod.
- Verify `CREATE UNIQUE INDEX` on all 5 mat views (REFRESH CONCURRENTLY needs them).
- Initial backfill: run `scripts/initial-load.ts` against prod DB.
- Backup policy: daily snapshot + PITR.
- Connection-limit sizing vs Next.js process count.

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
