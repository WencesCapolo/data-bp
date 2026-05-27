import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/modules/basket/infrastructure/db/schema.ts',
    './src/modules/partidos/infrastructure/db/schema.ts',
  ],
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
