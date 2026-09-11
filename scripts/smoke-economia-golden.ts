// Golden-output check for /financiero · Economía: the repository's getEconomia
// DTO, figure for figure, before and after a change to its queries.
//
//   pnpm smoke:economia-golden snapshot   # on the code you trust: writes .golden/economia/*.json
//   pnpm smoke:economia-golden diff       # on the new code: recomputes and compares
//
// Same database on both runs, or the diff means nothing. Money is compared to
// the cent, counts and labels exactly, array order as-is (the view relies on it).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { connection } from '@shared/db/client';
import { DrizzleAnalyticsQueryRepository } from '@basket/infrastructure/db/repositories/DrizzleAnalyticsQueryRepository';
import type { CommonFilters, DateRange } from '@basket/core/dtos/shared';

const DIR = '.golden/economia';
const CASES: { name: string; range: DateRange; filters?: CommonFilters }[] = [
  { name: 'all', range: { kind: 'all' } },
  { name: '30d', range: { kind: '30d' } },
  { name: '7d', range: { kind: '7d' } },
  { name: 'all-country', range: { kind: 'all' }, filters: { countries: ['AR'] } },
  { name: '30d-country', range: { kind: '30d' }, filters: { countries: ['AR', 'UY'] } },
  { name: '30d-access', range: { kind: '30d' }, filters: { accessType: 'real' } },
  { name: 'all-tier', range: { kind: 'all' }, filters: { subType: 'Mensual_Total' } },
  { name: '30d-empty', range: { kind: '30d' }, filters: { countries: ['ZZ'] } },
  // A month that has Pagos on a dev copy whose data stops in 2026-08, where
  // 30d and 7d are empty ranges: the sargable short-range paths need rows.
  { name: 'custom-month', range: { kind: 'custom', from: '2026-07-12', to: '2026-08-10' } },
  { name: 'custom-month-country', range: { kind: 'custom', from: '2026-07-12', to: '2026-08-10' }, filters: { countries: ['AR'] } },
];
/** GOLDEN_ONLY=name,name limits a run to some cases (to snapshot a new case
 *  on the old code without redoing the rest). */
const ONLY = (process.env.GOLDEN_ONLY ?? '').split(',').filter(Boolean);

type J = unknown;
const diffs: string[] = [];

/** Arrays whose order is a sort with ties, and so was never part of the
 *  contract: compared as sets, each row keyed by its dimensions. */
const UNORDERED: Record<string, (r: Record<string, J>) => string> = {
  catalog: (r) => [r.planFamily, r.planFrequency, r.market, r.currency, r.season, r.price].join('|'),
  byCountry: (r) => [r.country, r.currency].join('|'),
};
function canonical(name: string, v: J): J {
  const key = UNORDERED[name];
  if (!key || !Array.isArray(v)) return v;
  return [...(v as Record<string, J>[])].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
function compare(path: string, a: J, b: J): void {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 0.005 + 1e-9) diffs.push(`${path}: ${a} → ${b}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) diffs.push(`${path}: length ${a.length} → ${b.length}`);
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i += 1) compare(`${path}[${i}]`, a[i], b[i]);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) {
      compare(`${path}.${k}`, canonical(k, (a as Record<string, J>)[k]), canonical(k, (b as Record<string, J>)[k]));
    }
    return;
  }
  if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== 'snapshot' && mode !== 'diff') {
    console.error('usage: smoke-economia-golden snapshot|diff');
    process.exit(2);
  }
  mkdirSync(DIR, { recursive: true });
  const repo = new DrizzleAnalyticsQueryRepository();
  let failed = 0;
  for (const c of CASES) {
    if (ONLY.length > 0 && !ONLY.includes(c.name)) continue;
    const t0 = performance.now();
    const dto = await repo.getEconomia(c.range, c.filters);
    const ms = Math.round(performance.now() - t0);
    const file = `${DIR}/${c.name}.json`;
    if (mode === 'snapshot') {
      writeFileSync(file, JSON.stringify(dto, null, 1));
      console.log(`  wrote ${file.padEnd(36)} ${ms} ms`);
      continue;
    }
    if (!existsSync(file)) {
      console.log(`  ✗ ${c.name.padEnd(14)} no snapshot at ${file}`);
      failed += 1;
      continue;
    }
    const golden = JSON.parse(readFileSync(file, 'utf8')) as J;
    diffs.length = 0;
    compare(c.name, golden, JSON.parse(JSON.stringify(dto)));
    if (diffs.length > 0) failed += 1;
    console.log(`  ${diffs.length === 0 ? '✓' : '✗'} ${c.name.padEnd(14)} ${String(ms).padStart(5)} ms  ${diffs.length} differences`);
    for (const dline of diffs.slice(0, 25)) console.log(`      ${dline}`);
    if (diffs.length > 25) console.log(`      … ${diffs.length - 25} more`);
  }
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => connection.end());
