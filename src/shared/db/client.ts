import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as basketSchema from '@basket/infrastructure/db/schema';
import * as partidosSchema from '@partidos/infrastructure/db/schema';

const schema = { ...basketSchema, ...partidosSchema };

const globalForDb = globalThis as unknown as {
  connection: ReturnType<typeof postgres> | undefined;
};

function buildConnection(): ReturnType<typeof postgres> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const max = Number(process.env.DB_POOL_MAX ?? 10);
  const idleTimeout = Number(process.env.DB_IDLE_TIMEOUT_S ?? 30);
  const connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT_S ?? 10);
  return postgres(url, {
    max,
    idle_timeout: idleTimeout,
    connect_timeout: connectTimeout,
    prepare: false,
  });
}

export const connection = globalForDb.connection ?? buildConnection();

if (process.env.NODE_ENV !== 'production') {
  globalForDb.connection = connection;
}

export const db = drizzle(connection, { schema });
export type Db = typeof db;
