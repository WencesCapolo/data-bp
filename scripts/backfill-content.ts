// First load of the content history. The cron reads a 30-day window off `now`
// (step 5 of RunSyncUseCase), so `basket_content` only ever holds the last
// month; the prototype's Contenido tab needs every match back to the start.
//
//   tsx --env-file=.env scripts/backfill-content.ts
//   tsx --env-file=.env scripts/backfill-content.ts --from=2024-01-01 --window=1
//
// The endpoint's `to` is **exclusive**: a match dated exactly on it is not
// returned. So consecutive windows share their boundary day rather than abut,
// which costs nothing — the upsert is keyed on the content id, so an overlap
// re-reads a day instead of losing one. Windows are walked oldest-first and each
// is reported, so a gap in the history is visible as a zero rather than as a
// smaller total.

import { connection } from '@shared/db/client';
import { createCsvApiFetcher } from '@basket/infrastructure/sync/composeRunSync';
import { DrizzleContentRepository } from '@basket/infrastructure/db/repositories/DrizzleContentRepository';
import { DrizzleSyncStateRepository } from '@basket/infrastructure/db/repositories/DrizzleSyncStateRepository';
import { LoadContentFromCsvUseCase } from '@basket/core/use-cases/sync/LoadContentFromCsvUseCase';
import { mapContentRow, type ContentCsvRow } from '@basket/infrastructure/sync/csvMappers';
import type { ContentProps } from '@basket/core/entities/Content';

/** The first month with real matches. The prototype's Contenido tab says
 *  2021-09, but the endpoint carries rows back to here. */
const HISTORY_START = '2020-10-01';

/** A handful of rows carry a date typed decades off — one match is dated 2004
 *  and was created in 2024. Windowing from HISTORY_START would drop them, so a
 *  default run sweeps everything before it in one window first. */
const STRAY_START = '2000-01-01';

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `months`-wide windows, oldest first. Each `to` is the next window's `from`,
 *  because the endpoint excludes `to` — see the note at the top. */
function windows(from: Date, to: Date, months: number): { from: Date; to: Date }[] {
  const out: { from: Date; to: Date }[] = [];
  const last = new Date(to.getTime() + 86400_000);
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cursor <= to) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + months, 1));
    out.push({ from: cursor, to: next > last ? last : next });
    cursor = next;
  }
  return out;
}

async function main() {
  const from = new Date(`${arg('from') ?? HISTORY_START}T00:00:00Z`);
  const to = new Date(`${arg('to') ?? ymd(new Date())}T00:00:00Z`);
  const months = Number(arg('window') ?? '3');
  if (!Number.isFinite(months) || months < 1) throw new Error('--window must be a whole number of months');
  if (from > to) throw new Error(`--from ${ymd(from)} is after --to ${ymd(to)}`);

  const resource = process.env.EXTERNAL_CONTENT_PATH ?? 'content';
  const fetcher = createCsvApiFetcher();
  const repo = new DrizzleContentRepository();
  const loader = new LoadContentFromCsvUseCase(repo);
  const syncState = new DrizzleSyncStateRepository();
  const runAt = new Date();

  const slices = windows(from, to, months);
  // Only a default run sweeps the strays: an explicit --from means the caller
  // is refreshing a range, not rebuilding the history.
  if (!arg('from')) {
    slices.unshift({ from: new Date(`${STRAY_START}T00:00:00Z`), to: from });
  }
  console.log(`=== content backfill: ${ymd(slices[0].from)} → ${ymd(to)}, ${slices.length} windows of ${months}mo ===`);
  console.log(`rows before: ${(await repo.count()).toLocaleString()}\n`);

  let fetched = 0;
  let upserted = 0;
  let empty = 0;
  for (const w of slices) {
    const started = Date.now();
    let rows = 0;
    // The mapper drops rows with no numeric id; count what the API gave us
    // separately from what we could store, so a mapping regression is visible.
    async function* mapped(): AsyncGenerator<ContentProps> {
      for await (const row of fetcher.streamRows<Record<string, string>>(resource, {
        extraParams: { from: ymd(w.from), to: ymd(w.to) },
        omitSince: true,
      })) {
        rows++;
        const m = mapContentRow(row as unknown as ContentCsvRow);
        if (m) yield m;
      }
    }
    const r = await loader.execute({ rows: mapped() });
    fetched += rows;
    upserted += r.inserted;
    if (rows === 0) empty++;
    console.log(
      `  ${ymd(w.from)} → ${ymd(w.to)}  fetched=${String(rows).padStart(6)}  ` +
        `stored=${String(r.inserted).padStart(6)}  (${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
  }

  const total = await repo.count();
  await syncState.updateLastSync('content', runAt, total);

  console.log(
    `\nfetched ${fetched.toLocaleString()} rows, stored ${upserted.toLocaleString()}, ` +
      `${empty} empty window${empty === 1 ? '' : 's'}`,
  );
  console.log(`rows after: ${total.toLocaleString()}`);
  if (fetched > upserted) {
    console.warn(`⚠ ${fetched - upserted} rows the mapper rejected — check the header for a renamed column`);
  }
}

main()
  .catch((err) => {
    console.error(String((err as { cause?: unknown })?.cause ?? err));
    process.exitCode = 1;
  })
  .finally(() => connection.end());
