import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as basketSchema from '@basket/infrastructure/db/schema';

const schema = { ...basketSchema };

const globalForDb = globalThis as unknown as {
  connection: ReturnType<typeof postgres> | undefined;
};

function buildConnection(): ReturnType<typeof postgres> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  return postgres(url, { max: 10, prepare: false });
}

export const connection = globalForDb.connection ?? buildConnection();

if (process.env.NODE_ENV !== 'production') {
  globalForDb.connection = connection;
}

export const db = drizzle(connection, { schema });
export type Db = typeof db;
