import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';
const q = process.argv[2];
db.execute(sql.raw(q))
  .then((r) => console.log(JSON.stringify(r, null, 1)))
  .catch((e) => { console.error(String(e?.cause ?? e)); process.exitCode = 1; })
  .finally(() => connection.end());
