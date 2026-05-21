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
  const id = '10ARx4Ffj-Dc8zuwceqXi5lq3hX5jgbIRiTUv6pOQ5kM';
  const meta = await s.spreadsheets.get({spreadsheetId:id, fields:'sheets.properties.title'});
  console.log('tabs:', meta.data.sheets?.map(x=>x.properties?.title));
  const r = await s.spreadsheets.values.get({spreadsheetId:id, range:"'DATA'!A1:Z"});
  console.log('DATA rows:', r.data.values?.length);
  console.log(JSON.stringify(r.data.values, null, 2));
}
main().catch(e=>console.error(e));
