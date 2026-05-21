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
  for (const id of ['1elxGsS-cILaqJeWE5zOxucDVBXvAYdUQv47JLRJOzPQ','1ItzRADOrWidroAo6fzvhFOkk19GWnRC7NkXg-9HV6GI']) {
    const r = await s.spreadsheets.get({spreadsheetId:id, fields:'properties.title,sheets.properties.title'});
    console.log(id, '→ title:', r.data.properties?.title);
  }
}
main().catch(e=>console.error(e));
