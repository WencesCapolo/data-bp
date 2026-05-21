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
  const id = '1_PQmmBPsSNLnFYzMjK91GQ20nDi3Zyprw56Ij1NcVk8';
  const meta = await s.spreadsheets.get({spreadsheetId:id, fields:'sheets.properties.title'});
  console.log('tabs:', meta.data.sheets?.map(x=>x.properties?.title));
  const tab = 'Fixture Liga Femenina Ecuador 26';
  const r = await s.spreadsheets.values.get({spreadsheetId:id, range:`'${tab}'!A1:Z6`});
  console.log('\n=== '+tab+' head ===');
  console.log(JSON.stringify(r.data.values, null, 2));
  const full = await s.spreadsheets.values.get({spreadsheetId:id, range:`'${tab}'!A1:Z`});
  console.log('total rows:', full.data.values?.length);
}
main().catch(e=>console.error(e));
