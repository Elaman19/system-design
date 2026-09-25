import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// DB_USER/DB_PASSWORD/DB_PORT must match whatever Compose actually starts Postgres
// with, so read them from .env.example (checked in, always present) instead of
// duplicating literals that could silently drift out of sync.
const exampleEnv = parse(readFileSync(new URL('.env.example', import.meta.url)));

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    env: {
      NODE_ENV: 'test',
      DB_HOST: 'localhost', // tests run on the host, not inside the Compose network
      DB_PORT: exampleEnv.DB_PORT,
      DB_USER: exampleEnv.DB_USER,
      DB_PASSWORD: exampleEnv.DB_PASSWORD,
      DB_NAME: 'app_test', // isolated from the app's own database, see AGENTS.md
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts', // entry point: boots a real HTTP server; app itself is exercised via Test.createTestingModule
        'src/data-source.ts', // TypeORM CLI config, never executed by the running app
        'src/migrations/**', // verified by running against a real database, not unit tests
        '**/*.spec.ts',
        '**/*.e2e-spec.ts',
      ],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
