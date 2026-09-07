import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Core modules are pure and import nothing from Next or the database, so the
// tests need only the same path aliases tsconfig declares.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@basket': path.resolve(__dirname, 'src/modules/basket'),
      '@partidos': path.resolve(__dirname, 'src/modules/partidos'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
