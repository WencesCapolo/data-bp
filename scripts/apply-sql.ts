import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { connection, db } from '@shared/db/client';

// Applies a migration file one statement at a time.
//
// There is no psql on the production box, so every migration except
// 0001_views.sql lands through this. Sending a whole file as a single query puts
// it in an implicit transaction, and `CREATE INDEX CONCURRENTLY` cannot run
// inside one — so the file is split and each statement is sent on its own.
//
//   pnpm sql:apply migrations/sql/0016_users_lower_email_idx.sql
//   pnpm sql:apply migrations/sql/0012_gateway_fees.sql migrations/sql/0013_...
//
// Splitting is dollar-quote aware: a DO $$ ... $$ block keeps its semicolons.

function splitStatements(content: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  let dollarTag: string | null = null;

  while (i < content.length) {
    const rest = content.slice(i);

    if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buf += content[i];
      i += 1;
      continue;
    }

    if (rest.startsWith('--')) {
      const end = content.indexOf('\n', i);
      const stop = end === -1 ? content.length : end;
      buf += content.slice(i, stop);
      i = stop;
      continue;
    }

    if (rest.startsWith('/*')) {
      const end = content.indexOf('*/', i + 2);
      const stop = end === -1 ? content.length : end + 2;
      buf += content.slice(i, stop);
      i = stop;
      continue;
    }

    if (content[i] === "'" || content[i] === '"') {
      const quote = content[i];
      let j = i + 1;
      while (j < content.length) {
        if (content[j] === quote && content[j + 1] === quote) {
          j += 2;
          continue;
        }
        if (content[j] === quote) break;
        j += 1;
      }
      buf += content.slice(i, Math.min(j + 1, content.length));
      i = j + 1;
      continue;
    }

    const dollar = /^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/.exec(rest);
    if (dollar) {
      dollarTag = dollar[0];
      buf += dollarTag;
      i += dollarTag.length;
      continue;
    }

    if (content[i] === ';') {
      out.push(buf);
      buf = '';
      i += 1;
      continue;
    }

    buf += content[i];
    i += 1;
  }

  out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s.length > 0 && !/^(--[^\n]*\n?)*$/.test(s));
}

function label(statement: string): string {
  const firstLine = statement
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('--'));
  const text = (firstLine ?? statement).replace(/\s+/g, ' ');
  return text.length > 78 ? `${text.slice(0, 75)}...` : text;
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: pnpm sql:apply <file.sql> [more.sql ...]');
    process.exitCode = 1;
    return;
  }

  const dbName = await db.execute(sql.raw('SELECT current_database() AS d'));
  const target = (dbName as unknown as Array<{ d: string }>)[0].d;
  console.log(`=== apply-sql → database "${target}" ===\n`);

  for (const file of files) {
    const path = resolve(process.cwd(), file);
    const statements = splitStatements(readFileSync(path, 'utf8'));
    console.log(`→ ${file}  (${statements.length} statement${statements.length === 1 ? '' : 's'})`);

    for (const [idx, statement] of statements.entries()) {
      const startedAt = Date.now();
      await db.execute(sql.raw(statement));
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`  ${String(idx + 1).padStart(2)}. ✓ ${secs.padStart(6)}s  ${label(statement)}`);
    }
    console.log('');
  }

  console.log('✓ all files applied');
}

main()
  .catch((err) => {
    console.error('\n✗ apply-sql failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end();
  });
