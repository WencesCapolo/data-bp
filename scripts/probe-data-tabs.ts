import { readFileSync } from 'node:fs';
try { for (const line of readFileSync('.env','utf8').split('\n')) { const m=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]]=m[2]; } } catch {}

async function main() {
  const { google } = await import('googleapis');
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY!.replace(/\\n/g,'\n'),
    scopes:['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const s = google.sheets({version:'v4', auth});

  const workbooks: { label: string; id: string }[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    const m = k.match(/^GOOGLE_SHEETS_FIXTURE_([A-Z0-9_]+)_ID$/);
    if (m && v) workbooks.push({ label: m[1], id: v });
  }
  console.log(`workbooks: ${workbooks.length}`);

  for (const wb of workbooks) {
    console.log(`\n========== ${wb.label} (${wb.id}) ==========`);
    try {
      const meta = await s.spreadsheets.get({ spreadsheetId: wb.id, fields: 'sheets.properties.title' });
      const tabs = (meta.data.sheets ?? []).map(x => x.properties?.title ?? '');
      console.log('tabs:', tabs);
      const dataTabs = tabs.filter(t => /^data$/i.test(t));
      if (dataTabs.length === 0) {
        console.log('NO DATA TAB');
        continue;
      }
      for (const tab of dataTabs) {
        console.log(`-- tab: ${tab}`);
        const full = await s.spreadsheets.values.get({ spreadsheetId: wb.id, range: `'${tab}'!A1:Z` });
        const rows = full.data.values ?? [];
        console.log(`total rows: ${rows.length}`);
        const sample = rows.slice(0, 12);
        console.log(JSON.stringify(sample, null, 2));
      }
    } catch (e: any) {
      console.log('ERROR:', e?.message ?? e);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
