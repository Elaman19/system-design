# Agent rules for this project

- The task is not done until `npm run ci` is green. Do not report work as complete with a failing or skipped check.
- `npm run ci` = `db:test:up` (bootstraps `.env` from `.env.example` if missing, starts Postgres via Docker Compose, ensures the `app_test` database exists) + `typecheck` + `lint` + `format:check` + `test:cov`.
- Coverage thresholds (100% lines/branches/functions/statements) live in `vitest.config.ts` under `test.coverage.thresholds`. Do not lower them.
- Only exclude a file from coverage if it cannot be meaningfully unit-tested (e.g. `main.ts`, `data-source.ts`, migrations). Every exclusion in `vitest.config.ts` must carry a comment explaining why.
- Under Vitest, oxc transpiles each file in isolation and emits `typeof X === "undefined" ? Object : X` into `design:paramtypes` for constructor-injected dependencies; tsc (`nest build`) emits plain `X`. The `stripDecoratorMetadataGuard` plugin in `vitest.config.ts` removes that guard so coverage matches the shipped code. Do not write `vi.doMock(... undefined)` tests to cover it.
- Tests run against the `app_test` database (see `vitest.config.ts` `test.env`). Never point tests at the `app` (dev) database.
- Stack: NestJS (Express, `nest new` scaffold) + TypeORM (Postgres) + nestjs-pino (logger) + Vitest + oxlint. See README for the full rationale.
