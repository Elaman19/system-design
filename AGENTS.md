# Agent rules for this project

- The task is not done until `npm run ci` is green. Do not report work as complete with a failing or skipped check.
- `npm run ci` = `db:test:up` (bootstraps `.env` from `.env.example` if missing, starts Postgres via Docker Compose, recreates the `app_test` database empty and applies all migrations to it with `db:test:migrate`, so migrations are exercised from scratch on every run) + `typecheck` + `lint` + `format:check` + `test:cov`.
- Coverage thresholds (100% lines/branches/functions/statements) live in `vitest.config.ts` under `test.coverage.thresholds`. Do not lower them.
- Only exclude a file from coverage if it cannot be meaningfully unit-tested (e.g. `main.ts`, `data-source.ts`, migrations). Every exclusion in `vitest.config.ts` must carry a comment explaining why.
- Under Vitest, oxc transpiles each file in isolation and emits `typeof X === "undefined" ? Object : X` into `design:paramtypes` for constructor-injected dependencies; tsc (`nest build`) emits plain `X`. The `stripDecoratorMetadataGuard` plugin in `vitest.config.ts` removes that guard so coverage matches the shipped code. Do not write `vi.doMock(... undefined)` tests to cover it.
- Schema changes go through migrations in `src/migrations/` (hand-written SQL, applied by a separate step: `npm run migration:run`, the Compose `migrate` service, or `db:test:migrate` in CI). The app never changes the schema on startup. Business rules that the database can enforce (unique indexes, `CHECK`, foreign keys) live in the migration; code only maps the violation to a clear 4xx (`src/db/pg-error.filter.ts`).
- Tests run against the `app_test` database (see `vitest.config.ts` `test.env`). Never point tests at the `app` (dev) database.
- Stack: NestJS (Express, `nest new` scaffold) + TypeORM (Postgres) + nestjs-pino (logger) + Vitest + oxlint. See README for the full rationale.
