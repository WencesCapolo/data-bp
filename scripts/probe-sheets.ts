import { readFileSync } from 'node:fs';
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

async function main() {
  const { GoogleSheetsFetcher } = await import('@basket/infrastructure/sheets/GoogleSheetsFetcher');
  const f = new GoogleSheetsFetcher({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    privateKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY!,
  });
  const targets = [
    ['INCIDENCIAS', process.env.GOOGLE_SHEETS_ID_INCIDENCIAS],
    ['GRILLA',      process.env.GOOGLE_SHEETS_ID_GRILLA],
    ['TOTAL',       process.env.GOOGLE_SHEETS_ID_TOTAL_PARTIDOS],
  ] as const;
  for (const [label, id] of targets) {
    if (!id) { console.log(label, '(no id)'); continue; }
    try {
      const tabs = await f.listTabs(id);
      console.log(label, '→', tabs);
    } catch (e) {
      console.log(label, 'ERR', (e as Error).message);
    }
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
