import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

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
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'app',
      DB_PASSWORD: 'app',
      DB_NAME: 'app_test',
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
        functions: 100,
        statements: 100,
        // Global branches floor is below 100/98 only because of a single, well-understood gap
        // (see the per-file entry and comment below). Raise this back toward 100 as soon as
        // new real conditional logic dilutes that fixed gap enough to clear it — do not treat
        // 83 as a permanent target.
        branches: 83,
        // TypeScript's emitDecoratorMetadata (required for Nest's constructor-based DI)
        // compiles every decorated class with constructor params to include a
        // `typeof Reflect.metadata === 'function'` guard. It's always true here since
        // reflect-metadata is loaded app-wide, so the false branch is unreachable without
        // faking an environment that can't occur in this app. Inline v8/istanbul ignore
        // comments can't suppress it either (verified): the branch has no matching node in
        // the original source, only in the compiler-emitted helper. Add a file entry here,
        // with this same justification, whenever a new class hits the same wall.
        'src/app.controller.ts': {
          branches: 50,
        },
      },
    },
  },
});
