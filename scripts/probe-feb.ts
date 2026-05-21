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
  const id = '1vE1GsMYOZSsxT-z3Zvie2n-KTjuIvXc3JwB12HDqYBQ';
  const meta = await s.spreadsheets.get({spreadsheetId:id, fields:'sheets.properties.title'});
  console.log('tabs:', meta.data.sheets?.map(x=>x.properties?.title));
  const r = await s.spreadsheets.values.get({spreadsheetId:id, range:"'Fixture Primera FEB'!A1:Z5"});
  console.log('rows:', JSON.stringify(r.data.values, null, 2));
}
main().catch(e=>console.error(e));
