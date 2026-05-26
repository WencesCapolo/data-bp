const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const TOKEN = process.env.INTERNAL_API_TOKEN ?? process.env.SYNC_TOKEN;
const HEADERS: HeadersInit = TOKEN ? { 'x-internal-token': TOKEN, 'x-sync-token': TOKEN } : {};

interface Target {
  label: string;
  path: string;
  budgetMs: number;
}

const TARGETS: Target[] = [
  { label: 'evolution range=all day',   path: '/api/basket/evolution?range=all&granularity=day',   budgetMs: 500 },
  { label: 'evolution range=all week',  path: '/api/basket/evolution?range=all&granularity=week',  budgetMs: 500 },
  { label: 'evolution range=all month', path: '/api/basket/evolution?range=all&granularity=month', budgetMs: 500 },
  { label: 'overview range=all',        path: '/api/basket/overview?range=all',                    budgetMs: 500 },
  { label: 'teams range=all',           path: '/api/basket/teams?range=all',                       budgetMs: 500 },
  { label: 'finance range=all',         path: '/api/basket/finance?range=all',                     budgetMs: 500 },
  { label: 'meta',                      path: '/api/basket/meta',                                  budgetMs: 200 },
];

const RUNS = Number(process.env.PERF_RUNS ?? 5);
const WARMUP = Number(process.env.PERF_WARMUP ?? 1);

function pct(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

async function timeOnce(path: string): Promise<{ ms: number; status: number; bytes: number }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
  const body = await res.arrayBuffer();
  return { ms: performance.now() - t0, status: res.status, bytes: body.byteLength };
}

async function run(): Promise<void> {
  console.log(`\nPerf smoke @ ${BASE} (warmup=${WARMUP}, runs=${RUNS})\n`);
  let failed = 0;
  for (const t of TARGETS) {
    for (let i = 0; i < WARMUP; i++) await timeOnce(t.path);
    const samples: number[] = [];
    let lastStatus = 0;
    let bytes = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = await timeOnce(t.path);
      samples.push(r.ms);
      lastStatus = r.status;
      bytes = r.bytes;
    }
    const p50 = pct(samples, 50);
    const p95 = pct(samples, 95);
    const ok = lastStatus < 400 && p95 <= t.budgetMs;
    if (!ok) failed++;
    const flag = ok ? '✓' : '✗';
    console.log(
      `${flag} ${t.label.padEnd(34)} status=${lastStatus} p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms budget=${t.budgetMs}ms bytes=${bytes}`,
    );
  }
  console.log('');
  if (failed > 0) {
    console.error(`${failed} target(s) over budget`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
