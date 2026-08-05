// Smoke test for the Pagos Export Upload → Sync → dashboards path.
//
// Same idiom as scripts/smoke-api.ts: a declared PROBES list run against a live
// server, one line of output per probe. Unlike smoke-api the probes here are
// ordered and share state (the uploadId minted by probe 1, the totals probe 7
// compares against), so each probe gets a Ctx instead of a bare path.
//
// Every assertion is on externally observable behaviour only: HTTP status, the
// UploadPreviewDTO / UploadRejectionDTO / UploadResultDTO contract in
// src/modules/basket/core/dtos/PaymentUploadDTO.ts, the /api/sync payload and
// the FinanceDTO. Nothing here knows about mapper internals, staging file names
// or batch sizes.
//
// Fixtures are the REAL Exports committed at the repo root, because they carry
// quirks a synthetic file would smooth over (a Window shorter than a month, a
// four-Provider mix, 1706 failed Pagos, and — in the Suscripciones Export —
// data rows one field short of the header).
//
// Requires a server already running at API_BASE and INTERNAL_API_TOKEN matching
// the server's own, which src/proxy.ts honours only when NODE_ENV !== production.
//
//   pnpm smoke:payments-upload

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type {
  UploadPreviewDTO,
  UploadRejectionCode,
  UploadResultDTO,
  UploadWarningCode,
} from '@basket/core/dtos/PaymentUploadDTO';

const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN;
const SYNC_TOKEN = process.env.SYNC_TOKEN;

const UPLOAD_PATH = '/api/basket/payments/upload';
const SYNC_PATH = '/api/sync';
const FINANCE_PATH = '/api/basket/finance';

/** Poll budget for one Sync. Generous: a full Sync rebuilds every mat view. */
const SYNC_TIMEOUT_MS = 10 * 60 * 1000;
const SYNC_POLL_MS = 3_000;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The correct Pagos Export. Numbers below were recounted from the file with a
 *  real CSV parser, not taken on trust; `approved`/`failed` follow the DTO's
 *  definition (status=1 vs status=0) and split 5792/1706, not 5804/1694. */
const PAGOS = {
  path: resolve(process.cwd(), 'payments20260804223735.csv'),
  rowTotal: 7498,
  windowFrom: '2026-07-28',
  windowTo: '2026-08-04',
  byProvider: { MercadoPago: 4961, Stripe: 2483, PayPal: 44, Manual: 10 } as Record<string, number>,
  approved: 5792,
  failed: 1706,
  // The status=0 bucket, split by status_detail. Counts recounted from the file:
  // rejected 550; pending 968 + in_process 24; cancelled 85 + canceled 8 +
  // incomplete_expired 54 + refunded 9 + in_mediation 8. Sums back to `failed`.
  rejected: 550,
  pending: 992,
  otherNotApproved: 164,
};

/** The WRONG file: a Suscripciones Export. Every row status=1, so zero failed
 *  Pagos, which is exactly what `looks_like_subscriptions` detects. Its data
 *  rows also carry only 14 fields against the 15-column header. */
const SUBSCRIPCIONES = {
  path: resolve(process.cwd(), 'subscriptions20260803144655.csv'),
  rowTotal: 22632,
};

/** Tiers that cost money. `Free` and `Otros` prove nothing about the price-tier
 *  fallback, so probe 6 ignores them. */
const PAID_TIERS = ['Mensual_Basico', 'Mensual_Total', 'Anual_Total'] as const;

// ---------------------------------------------------------------------------
// Small assertion helpers
// ---------------------------------------------------------------------------

type Json = unknown;

const isObj = (v: Json): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isArr = (v: Json): v is unknown[] => Array.isArray(v);

const numField = (b: Json, k: string): number | null => {
  if (!isObj(b)) return null;
  const v = b[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

const strField = (b: Json, k: string): string | null => {
  if (!isObj(b)) return null;
  const v = b[k];
  return typeof v === 'string' ? v : null;
};

function expectNum(b: Json, k: string, want: number): string | null {
  const got = numField(b, k);
  if (got === null) return `missing/non-numeric ${k}`;
  return got === want ? null : `${k}=${got} (expected ${want})`;
}

function hasWarning(b: Json, code: UploadWarningCode): string | null {
  if (!isObj(b) || !isArr(b.warnings)) return 'missing warnings[]';
  const codes = b.warnings.filter(isObj).map((w) => w.code);
  return codes.includes(code) ? null : `no ${code} warning (got [${codes.join(', ')}])`;
}

/** Chains checks, returning the first failure. Keeps probes readable. */
function first(...checks: Array<string | null>): string | null {
  return checks.find((c) => c !== null) ?? null;
}

function sameCounts(got: Json, want: Record<string, number>, label: string): string | null {
  if (!isObj(got)) return `${label} is not an object`;
  const diffs: string[] = [];
  for (const [k, v] of Object.entries(want)) {
    if (got[k] !== v) diffs.push(`${k}=${String(got[k])} (expected ${v})`);
  }
  for (const k of Object.keys(got)) {
    if (!(k in want)) diffs.push(`unexpected ${k}=${String(got[k])}`);
  }
  return diffs.length > 0 ? `${label}: ${diffs.join(', ')}` : null;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'x-internal-token': INTERNAL_TOKEN as string };
  // /api/sync guards itself with x-sync-token when SYNC_TOKEN is configured.
  if (SYNC_TOKEN) h['x-sync-token'] = SYNC_TOKEN;
  return h;
}

interface Res {
  status: number;
  body: Json;
  /** Non-null when the response could not be read as JSON. */
  raw: string | null;
}

async function readRes(res: Response): Promise<Res> {
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as Json, raw: null };
  } catch {
    return { status: res.status, body: null, raw: text.slice(0, 300) };
  }
}

/** 401 from the proxy is the single most confusing failure here, so name it. */
function authHint(r: Res): string | null {
  if (r.status !== 401) return null;
  return (
    '401 unauthorized — INTERNAL_API_TOKEN must match the value the server was started ' +
    'with, and the server must run with NODE_ENV !== production (see src/proxy.ts)'
  );
}

async function postMultipart(path: string, filePath: string, filename: string): Promise<Res> {
  const bytes = new Uint8Array(readFileSync(filePath));
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'text/csv' }), filename);
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: authHeaders(), body: form });
  return readRes(res);
}

async function postJson(path: string, payload: unknown, headers: Record<string, string>) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readRes(res);
}

async function getJson(path: string): Promise<Res> {
  return readRes(await fetch(`${BASE}${path}`, { headers: authHeaders() }));
}

// ---------------------------------------------------------------------------
// Sync driving
// ---------------------------------------------------------------------------

/** Depth-first hunt for the UploadResultDTO the sync endpoint reports. Its
 *  position in the payload is the sync route's business; the DTO is the
 *  contract, so match on the shape rather than on a guessed field path. */
function findUploadResult(v: Json, uploadId: string): UploadResultDTO | null {
  if (isArr(v)) {
    for (const item of v) {
      const hit = findUploadResult(item, uploadId);
      if (hit) return hit;
    }
    return null;
  }
  if (!isObj(v)) return null;
  if (
    v.uploadId === uploadId &&
    typeof v.rowsIngested === 'number' &&
    typeof v.rowsSkipped === 'number'
  ) {
    return v as unknown as UploadResultDTO;
  }
  for (const item of Object.values(v)) {
    const hit = findUploadResult(item, uploadId);
    if (hit) return hit;
  }
  return null;
}

function paymentsRowCount(syncBody: Json): number | null {
  if (!isObj(syncBody) || !isArr(syncBody.sources)) return null;
  const row = syncBody.sources.filter(isObj).find((s) => s.source === 'payments');
  return row && typeof row.rowCount === 'number' ? row.rowCount : null;
}

interface SyncOutcome {
  error: string | null;
  final: Json;
}

/** POSTs a Sync for `uploadId`, then polls until it settles. */
async function runSync(uploadId: string): Promise<SyncOutcome> {
  const started = await postJson(SYNC_PATH, { uploadId }, authHeaders());
  if (started.status !== 202) {
    return {
      error:
        authHint(started) ??
        `POST ${SYNC_PATH} status=${started.status} (expected 202)${
          started.raw ? ` body=${started.raw}` : ''
        }`,
      final: started.body,
    };
  }

  const deadline = Date.now() + SYNC_TIMEOUT_MS;
  let last: Res = started;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, SYNC_POLL_MS));
    last = await getJson(SYNC_PATH);
    if (last.status !== 200) {
      return { error: authHint(last) ?? `GET ${SYNC_PATH} status=${last.status}`, final: last.body };
    }
    if (isObj(last.body) && last.body.inFlight === false) {
      const merged = { started: started.body, ...(last.body as Record<string, unknown>) };
      return { error: null, final: merged };
    }
  }
  const waited = Math.round(SYNC_TIMEOUT_MS / 1000);
  return {
    error:
      `Sync did not finish within ${waited}s — GET ${SYNC_PATH} still reports inFlight=true. ` +
      'Check the server log: a Sync that hangs is usually a Platform fetch with no timeout, ' +
      'or a materialized-view refresh blocked on a lock.',
    final: last.body,
  };
}

function syncErrorSuffix(final: Json): string {
  const err = strField(final, 'lastError');
  return err ? ` (lastError=${err})` : '';
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

interface FinanceShape {
  revenueByDay: Array<{ totalAmount?: unknown }>;
  byCurrency: Array<{ totalAmount?: unknown }>;
}

function financeShapeError(b: Json): string | null {
  for (const k of ['range', 'revenueByDay', 'byPlatform', 'byCurrency', 'platformMonthly']) {
    if (!isObj(b) || !(k in b)) return `missing FinanceDTO field ${k}`;
  }
  const o = b as Record<string, unknown>;
  for (const k of ['revenueByDay', 'byPlatform', 'byCurrency', 'platformMonthly']) {
    if (!isArr(o[k])) return `FinanceDTO.${k} is not an array`;
  }
  return null;
}

function sumTotalAmount(rows: unknown): number {
  if (!isArr(rows)) return 0;
  return rows.reduce<number>((acc, r) => {
    const v = isObj(r) ? r.totalAmount : null;
    return acc + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  }, 0);
}

/** Revenue per paid Tier, from FinanceDTO filtered by subType. A non-zero value
 *  for any of them means the Pago was mapped, its Tier resolved through the
 *  price-tier fallback, its derived expiry made it active, and the mat views
 *  were rebuilt — none of which this script can see directly. */
async function tierTotals(): Promise<{ error: string | null; totals: Record<string, number> }> {
  const totals: Record<string, number> = {};
  for (const tier of PAID_TIERS) {
    const r = await getJson(`${FINANCE_PATH}?range=all&subType=${tier}`);
    if (r.status !== 200) {
      return {
        error: authHint(r) ?? `GET ${FINANCE_PATH}?subType=${tier} status=${r.status}`,
        totals,
      };
    }
    const shape = financeShapeError(r.body);
    if (shape) return { error: `${tier}: ${shape}`, totals };
    const f = r.body as unknown as FinanceShape;
    // revenueByDay and byCurrency are two independent aggregations of the same
    // Pagos; take the larger so a range-clipped daily series cannot mask money.
    totals[tier] = Math.max(sumTotalAmount(f.revenueByDay), sumTotalAmount(f.byCurrency));
  }
  return { error: null, totals };
}

const fmtTotals = (t: Record<string, number>): string =>
  Object.entries(t)
    .map(([k, v]) => `${k}=${v.toFixed(2)}`)
    .join(' ');

// ---------------------------------------------------------------------------
// Generated fixtures (temp files, cleaned up in main())
// ---------------------------------------------------------------------------

const TMP_XLSX = resolve(tmpdir(), `smoke-pagos-${process.pid}.xlsx`);
const TMP_BAD_HEADER = resolve(tmpdir(), `smoke-pagos-bad-header-${process.pid}.csv`);

/** A believable Excel workbook as far as byte sniffing goes: the ZIP magic
 *  number every .xlsx starts with. Enough to prove non-CSV is refused. */
function writeFakeXlsx(): void {
  writeFileSync(TMP_XLSX, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00]));
}

/** The real Export with its header line mangled — one column renamed. Only the
 *  first rows are kept: the header is rejected before any of them is read. */
function writeMangledHeader(): void {
  const lines = readFileSync(PAGOS.path, 'utf8').split('\n');
  const header = lines[0].replace('amount', 'importe');
  writeFileSync(TMP_BAD_HEADER, [header, ...lines.slice(1, 21)].join('\n'));
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

interface Ctx {
  uploadId: string | null;
  preview: UploadPreviewDTO | null;
  paymentsRows: number | null;
  tiers: Record<string, number> | null;
}

interface Probe {
  label: string;
  run: (ctx: Ctx) => Promise<string | null>;
}

/** Shared assertions for a rejected upload. */
async function expectRejection(
  path: string,
  filename: string,
  code: UploadRejectionCode,
  messageMustMatch?: RegExp,
): Promise<string | null> {
  const r = await postMultipart(UPLOAD_PATH, path, filename);
  const hint = authHint(r);
  if (hint) return hint;
  if (r.status < 400 || r.status >= 500) {
    return `status=${r.status} (expected a 4xx rejection)`;
  }
  const got = strField(r.body, 'error');
  if (got !== code) return `error=${String(got)} (expected ${code})`;
  const msg = strField(r.body, 'message');
  if (msg === null) return 'missing message';
  if (messageMustMatch && !messageMustMatch.test(msg)) {
    return `message does not mention CSV: ${JSON.stringify(msg)}`;
  }
  return null;
}

const PROBES: Probe[] = [
  {
    label: 'POST upload — real Pagos Export',
    run: async (ctx) => {
      const r = await postMultipart(UPLOAD_PATH, PAGOS.path, 'payments20260804223735.csv');
      const hint = authHint(r);
      if (hint) return hint;
      if (r.status !== 200) {
        return `status=${r.status} (expected 200)${r.raw ? ` body=${r.raw}` : ''}`;
      }
      const b = r.body;
      const uploadId = strField(b, 'uploadId');
      const from = strField(b, 'windowFrom');
      const to = strField(b, 'windowTo');
      const days = numField(b, 'windowDays');
      const failed = numField(b, 'failed');
      const err = first(
        uploadId && uploadId.length > 0 ? null : 'missing uploadId',
        expectNum(b, 'rowTotal', PAGOS.rowTotal),
        from?.startsWith(PAGOS.windowFrom) ? null : `windowFrom=${String(from)} (expected ${PAGOS.windowFrom})`,
        to?.startsWith(PAGOS.windowTo) ? null : `windowTo=${String(to)} (expected ${PAGOS.windowTo})`,
        // 28/07 → 04/08 is 8 calendar days, 7 elapsed; accept either convention.
        days === 7 || days === 8 ? null : `windowDays=${String(days)} (expected 7 or 8)`,
        sameCounts(isObj(b) ? b.byProvider : null, PAGOS.byProvider, 'byProvider'),
        expectNum(b, 'approved', PAGOS.approved),
        expectNum(b, 'failed', PAGOS.failed),
        failed !== null && failed > 0 ? null : 'failed must be > 0 for a Pagos Export',
        expectNum(b, 'rejected', PAGOS.rejected),
        expectNum(b, 'pending', PAGOS.pending),
        expectNum(b, 'otherNotApproved', PAGOS.otherNotApproved),
        // The split must be exhaustive: a status_detail nobody classified would
        // otherwise vanish from the modal without anyone noticing.
        PAGOS.rejected + PAGOS.pending + PAGOS.otherNotApproved === PAGOS.failed
          ? null
          : 'rejected + pending + otherNotApproved must sum to failed',
        hasWarning(b, 'short_window'),
      );
      if (err) return err;
      ctx.uploadId = uploadId;
      ctx.preview = b as unknown as UploadPreviewDTO;
      return null;
    },
  },
  {
    label: 'POST upload — Suscripciones Export warns',
    run: async () => {
      const r = await postMultipart(UPLOAD_PATH, SUBSCRIPCIONES.path, 'subscriptions20260803144655.csv');
      const hint = authHint(r);
      if (hint) return hint;
      if (r.status !== 200) {
        return `status=${r.status} (expected 200 with a warning, not a rejection)${
          r.raw ? ` body=${r.raw}` : ''
        }`;
      }
      return first(
        expectNum(r.body, 'rowTotal', SUBSCRIPCIONES.rowTotal),
        expectNum(r.body, 'failed', 0),
        hasWarning(r.body, 'looks_like_subscriptions'),
      );
    },
  },
  {
    label: 'POST upload — .xlsx rejected as not_csv',
    run: async () => expectRejection(TMP_XLSX, 'pagos.xlsx', 'not_csv', /csv/i),
  },
  {
    label: 'POST upload — mangled header rejected',
    run: async () => expectRejection(TMP_BAD_HEADER, 'pagos-bad-header.csv', 'bad_header'),
  },
  {
    label: 'POST /api/sync — ingests the upload',
    run: async (ctx) => {
      if (!ctx.uploadId) return 'skipped: no uploadId (probe 1 failed)';
      const { error, final } = await runSync(ctx.uploadId);
      if (error) return error;
      const rows = paymentsRowCount(final);
      if (rows === null) return `no payments source in GET ${SYNC_PATH}${syncErrorSuffix(final)}`;
      if (rows <= 0) return `payments rowCount=${rows}, no Pagos ingested${syncErrorSuffix(final)}`;
      const result = findUploadResult(final, ctx.uploadId);
      if (!result) {
        return `no UploadResultDTO for uploadId=${ctx.uploadId} in the sync payload${syncErrorSuffix(final)}`;
      }
      if (result.rowTotal !== PAGOS.rowTotal) {
        return `UploadResultDTO.rowTotal=${result.rowTotal} (expected ${PAGOS.rowTotal})`;
      }
      if (result.rowsIngested <= 0) {
        return `UploadResultDTO.rowsIngested=${result.rowsIngested}${syncErrorSuffix(final)}`;
      }
      if (result.rowsIngested + result.rowsSkipped !== result.rowTotal) {
        return `rowsIngested+rowsSkipped=${result.rowsIngested + result.rowsSkipped} != rowTotal=${result.rowTotal}`;
      }
      ctx.paymentsRows = rows;
      return null;
    },
  },
  {
    label: 'GET /finance — a paid Tier has revenue',
    run: async (ctx) => {
      const { error, totals } = await tierTotals();
      if (error) return error;
      const earning = Object.entries(totals).filter(([, v]) => v > 0);
      if (earning.length === 0) {
        return `every paid Tier is empty (${fmtTotals(totals)}) — mapper, Tier fallback, derived expiry or mat-view rebuild did not land`;
      }
      ctx.tiers = totals;
      return null;
    },
  },
  {
    label: 'Re-upload + re-sync is idempotent',
    run: async (ctx) => {
      if (!ctx.preview || ctx.paymentsRows === null || !ctx.tiers) {
        return 'skipped: no baseline from probes 1/5/6';
      }
      const r = await postMultipart(UPLOAD_PATH, PAGOS.path, 'payments20260804223735.csv');
      if (r.status !== 200) return `re-upload status=${r.status} (expected 200)`;
      const before = ctx.preview;
      const shifted = first(
        expectNum(r.body, 'rowTotal', before.rowTotal),
        expectNum(r.body, 'approved', before.approved),
        expectNum(r.body, 'failed', before.failed),
        sameCounts(isObj(r.body) ? r.body.byProvider : null, before.byProvider, 'byProvider'),
      );
      if (shifted) return `re-upload preview changed: ${shifted}`;

      const uploadId = strField(r.body, 'uploadId');
      if (!uploadId) return 're-upload returned no uploadId';
      const { error, final } = await runSync(uploadId);
      if (error) return error;

      const rows = paymentsRowCount(final);
      if (rows !== ctx.paymentsRows) {
        return `payments rowCount ${ctx.paymentsRows} → ${String(rows)} after re-sync (not idempotent)`;
      }
      const after = await tierTotals();
      if (after.error) return after.error;
      const drift = sameCounts(after.totals, ctx.tiers, 'tier revenue');
      return drift ? `${drift} (not idempotent)` : null;
    },
  },
  {
    label: 'POST /api/sync unauthenticated → 401',
    run: async () => {
      const r = await postJson(SYNC_PATH, {}, {});
      if (r.status === 401) return null;
      return `status=${r.status} (expected 401) — ${SYNC_PATH} accepts anonymous POSTs`;
    },
  },
];

// ---------------------------------------------------------------------------
// Preflight + runner
// ---------------------------------------------------------------------------

function preflight(): string | null {
  if (!INTERNAL_TOKEN) {
    return (
      'INTERNAL_API_TOKEN is not set.\n' +
      '  These endpoints sit behind a Better Auth session; src/proxy.ts accepts an\n' +
      '  x-internal-token bypass instead, but only when NODE_ENV !== production and\n' +
      '  INTERNAL_API_TOKEN is set. Without it every probe would just report 401.\n' +
      '  Fix: set INTERNAL_API_TOKEN in .env to the same value the server runs with.'
    );
  }
  for (const p of [PAGOS.path, SUBSCRIPCIONES.path]) {
    if (!existsSync(p)) {
      return `Missing fixture ${p}\n  The real Exports must be present at the repo root; run from the repo root.`;
    }
  }
  return null;
}

async function assertServerUp(): Promise<string | null> {
  try {
    await fetch(`${BASE}${SYNC_PATH}`, { headers: authHeaders() });
    return null;
  } catch (err) {
    return (
      `No server answering at ${BASE} (${err instanceof Error ? err.message : String(err)}).\n` +
      '  Start it yourself (pnpm dev) and re-run; this script never starts one.\n' +
      '  Override the origin with API_BASE=... if it listens elsewhere.'
    );
  }
}

async function main() {
  console.log(`=== Payments Upload Smoke against ${BASE} ===\n`);

  const bad = preflight() ?? (await assertServerUp());
  if (bad) {
    console.error(`✗ ${bad}`);
    process.exitCode = 1;
    return;
  }

  writeFakeXlsx();
  writeMangledHeader();

  const ctx: Ctx = { uploadId: null, preview: null, paymentsRows: null, tiers: null };
  let failed = 0;
  try {
    for (const p of PROBES) {
      const t = Date.now();
      let detail: string | null;
      try {
        detail = await p.run(ctx);
      } catch (err) {
        detail = `threw: ${err instanceof Error ? err.message : String(err)}`;
      }
      const ms = Date.now() - t;
      const mark = detail === null ? '✓' : '✗';
      console.log(
        `  ${mark} ${p.label.padEnd(40)} ${String(ms).padStart(6)}ms  ${detail ?? 'ok'}`,
      );
      if (detail !== null) failed++;
    }
  } finally {
    rmSync(TMP_XLSX, { force: true });
    rmSync(TMP_BAD_HEADER, { force: true });
  }

  if (ctx.tiers) console.log(`\n  tier revenue: ${fmtTotals(ctx.tiers)}`);
  console.log(`\n${failed === 0 ? '✓' : '✗'} ${PROBES.length - failed}/${PROBES.length} passed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('smoke-payments-upload failed:', err);
  process.exitCode = 1;
});
