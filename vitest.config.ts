import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { defineConfig, type Plugin } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Vite transpiles each TypeScript file on its own (oxc), so it can't tell
// whether an imported constructor param type is a class or an interface, and
// emits `typeof X === "undefined" ? Object : X` into design:paramtypes. tsc
// (used by `nest build`) sees the whole program and emits plain `X`. The
// `Object` half only exists under Vitest and is unreachable, so strip the
// guard to measure coverage against the code that actually ships.
function stripDecoratorMetadataGuard(): Plugin {
  const guard = /typeof (\w+) === "undefined" \? Object : \1\b/g;
  return {
    name: 'strip-decorator-metadata-guard',
    // Run after the built-in oxc transform, so we see transpiled output.
    enforce: 'post',
    transform(code, id) {
      if (!id.endsWith('.ts')) return;
      const stripped = code.replace(guard, '$1');
      if (stripped === code) return;
      // The replacement only shortens text within a single line, so line
      // numbers don't shift and the source map stays valid.
      return { code: stripped, map: null };
    },
  };
}

// DB_USER/DB_PASSWORD/DB_PORT must match whatever Compose actually starts Postgres
// with. Compose reads .env, so read the same file on top of .env.example (checked
// in): a .env made before a variable was introduced still gets its default here.
// `db:test:up` creates .env before tests run.
const readEnv = (name: string) => {
  const url = new URL(name, import.meta.url);
  return existsSync(url) ? parse(readFileSync(url)) : {};
};
const exampleEnv = { ...readEnv('.env.example'), ...readEnv('.env') };

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths(), stripDecoratorMetadataGuard()],
  test: {
    globals: true,
    root: './',
    // Kafka group joins and S3 writes are slower than the 5 s default.
    testTimeout: 30000,
    hookTimeout: 60000,
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-teardown.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: exampleEnv.PORT,
      DB_HOST: 'localhost', // tests run on the host, not inside the Compose network
      DB_PORT: exampleEnv.DB_PORT,
      DB_USER: exampleEnv.DB_USER,
      DB_PASSWORD: exampleEnv.DB_PASSWORD,
      WORK_ENDPOINT_ENABLED: 'true',
      SHUTDOWN_DRAIN_MS: '0', // no balancer to wait for in tests
      SHUTDOWN_TIMEOUT_MS: '2000',
      DB_NAME: 'app_test', // isolated from the app's own database, see AGENTS.md
      // Backing services run in Compose with ports published to the host. Tests
      // that need isolation inside them (queue prefix, topics, bucket) pick their own names.
      REDIS_URL: exampleEnv.REDIS_URL,
      S3_ENDPOINT: exampleEnv.S3_ENDPOINT,
      S3_ACCESS_KEY: exampleEnv.S3_ACCESS_KEY,
      S3_SECRET_KEY: exampleEnv.S3_SECRET_KEY,
      KAFKA_BROKERS: exampleEnv.KAFKA_BROKERS,
      MAIL_SMTP_URL: exampleEnv.MAIL_SMTP_URL,
      BULLMQ_PREFIX: 'test',
      KAFKA_GROUP_PREFIX: 'test-', // own consumer groups: a stack running on the same Kafka keeps its own
      TRUST_PROXY: 'loopback',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts', // entry point: boots a real HTTP server; app itself is exercised via Test.createTestingModule
        'src/data-source.ts', // TypeORM CLI config, never executed by the running app
        'src/entrypoints/**', // process entry points like main.ts: a bootstrap line each; the modules they start are tested through Test.createTestingModule
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
