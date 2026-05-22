const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN;
const HEADERS: HeadersInit | undefined = INTERNAL_TOKEN
  ? { 'x-internal-token': INTERNAL_TOKEN }
  : undefined;

interface Probe {
  label: string;
  path: string;
  validate: (body: unknown) => string | null;
  expectStatus?: number;
  maxMs?: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const need = (v: unknown, k: string): string | null =>
  isObj(v) && k in v ? null : `missing field ${k}`;

const PROBES: Probe[] = [
  {
    label: 'GET /meta',
    path: '/api/basket/meta',
    validate: (b) =>
      need(b, 'dataRange') ?? need(b, 'countries') ?? need(b, 'lastSync') ?? need(b, 'enums'),
  },
  {
    label: 'GET /overview',
    path: '/api/basket/overview',
    validate: (b) =>
      need(b, 'asOf') ?? need(b, 'kpis') ?? need(b, 'trend30d') ?? need(b, 'countryBreakdown'),
  },
  {
    label: 'GET /evolution?range=30d&granularity=day',
    path: '/api/basket/evolution?range=30d&granularity=day',
    validate: (b) => need(b, 'series') ?? need(b, 'range') ?? need(b, 'granularity'),
  },
  {
    label: 'GET /teams?range=all&limit=5',
    path: '/api/basket/teams?range=all&limit=5',
    validate: (b) => need(b, 'totals') ?? need(b, 'ranked'),
  },
  {
    label: 'GET /finance?range=30d',
    path: '/api/basket/finance?range=30d',
    validate: (b) => need(b, 'revenueByDay') ?? need(b, 'byPlatform') ?? need(b, 'byCurrency'),
  },
  {
    label: 'GET /retention',
    path: '/api/basket/retention',
    validate: (b) => need(b, 'rows') ?? need(b, 'latestChurnRatePct'),
  },
  {
    label: 'GET /data-quality',
    path: '/api/basket/data-quality',
    validate: (b) => need(b, 'totals') ?? need(b, 'issues'),
  },
  {
    label: 'GET /evolution?range=foo (expect 400)',
    path: '/api/basket/evolution?range=foo',
    validate: (b) => (isObj(b) && b.error === 'invalid_query' ? null : 'expected invalid_query'),
    expectStatus: 400,
  },
  {
    label: 'GET /evolution?range=custom (no from/to → 400)',
    path: '/api/basket/evolution?range=custom',
    validate: (b) => (isObj(b) && b.error === 'invalid_query' ? null : 'expected invalid_query'),
    expectStatus: 400,
  },
  {
    label: 'GET /overview?countries=Uruguay (filter live path)',
    path: '/api/basket/overview?countries=Uruguay',
    validate: (b) =>
      isObj(b) && isObj((b as { kpis?: unknown }).kpis)
        ? null
        : 'missing kpis on filtered overview',
  },
  {
    label: 'GET /overview?accessType=real',
    path: '/api/basket/overview?accessType=real',
    validate: (b) =>
      isObj(b) && isObj((b as { kpis?: unknown }).kpis) &&
      Number((b as { kpis: { activeVoucher: number } }).kpis.activeVoucher) === 0
        ? null
        : 'accessType=real should yield activeVoucher=0',
  },
  {
    label: 'GET /overview?subType=Anual_Total',
    path: '/api/basket/overview?subType=Anual_Total',
    validate: (b) =>
      isObj(b) && isObj((b as { kpis?: unknown }).kpis)
        ? null
        : 'missing kpis on subType filtered overview',
  },
  {
    label: 'GET /overview?accessType=bogus (expect 400)',
    path: '/api/basket/overview?accessType=bogus',
    validate: (b) => (isObj(b) && b.error === 'invalid_query' ? null : 'expected invalid_query'),
    expectStatus: 400,
  },
  {
    label: 'PERF /evolution?range=all (< 500ms)',
    path: '/api/basket/evolution?range=all&granularity=day',
    validate: (b) => need(b, 'series') ?? need(b, 'range'),
    maxMs: 500,
  },
];

async function probeTeamTrend(): Promise<Probe> {
  const teamsRes = await fetch(`${BASE}/api/basket/teams?range=all&limit=1`, { headers: HEADERS });
  const body = (await teamsRes.json()) as { ranked?: Array<{ teamId: number }> };
  const teamId = body.ranked?.[0]?.teamId ?? 1;
  return {
    label: `GET /teams/${teamId}/trend`,
    path: `/api/basket/teams/${teamId}/trend`,
    validate: (b) => need(b, 'teamId') ?? need(b, 'teamName') ?? need(b, 'points'),
  };
}

async function run(p: Probe): Promise<{ label: string; ok: boolean; ms: number; detail: string }> {
  const t = Date.now();
  const res = await fetch(`${BASE}${p.path}`, { headers: HEADERS });
  const ms = Date.now() - t;
  const expected = p.expectStatus ?? 200;
  if (res.status !== expected) {
    return { label: p.label, ok: false, ms, detail: `status=${res.status} (expected ${expected})` };
  }
  const body = await res.json();
  const err = p.validate(body);
  if (err) return { label: p.label, ok: false, ms, detail: err };
  if (p.maxMs && ms > p.maxMs) {
    return { label: p.label, ok: false, ms, detail: `slow: ${ms}ms > ${p.maxMs}ms` };
  }
  return { label: p.label, ok: true, ms, detail: 'ok' };
}

async function main() {
  console.log(`=== API Smoke against ${BASE} ===\n`);
  const all: Probe[] = [...PROBES, await probeTeamTrend()];
  let failed = 0;
  for (const p of all) {
    const r = await run(p);
    const mark = r.ok ? '✓' : '✗';
    console.log(`  ${mark} ${r.label.padEnd(48)} ${String(r.ms).padStart(4)}ms  ${r.detail}`);
    if (!r.ok) failed++;
  }
  console.log(`\n${failed === 0 ? '✓' : '✗'} ${all.length - failed}/${all.length} passed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('smoke-api failed:', err);
  process.exitCode = 1;
});
