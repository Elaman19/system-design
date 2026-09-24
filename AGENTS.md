# Agent rules for this project

- The task is not done until `npm run ci` is green. Do not report work as complete with a failing or skipped check.
- `npm run ci` = `db:test:up` (starts Postgres via Docker Compose) + `typecheck` + `lint` + `format:check` + `test:cov`.
- Coverage thresholds (100% lines/branches/functions/statements) live in `vitest.config.ts` under `test.coverage.thresholds`. Do not lower them.
- Only exclude a file from coverage if it cannot be meaningfully unit-tested (e.g. `main.ts`, `data-source.ts`, migrations). Every exclusion in `vitest.config.ts` must carry a comment explaining why.
- Tests run against the `app_test` database (see `vitest.config.ts` `test.env`). Never point tests at the `app` (dev) database.
- Stack: NestJS + TypeORM (Postgres) + nestjs-pino (logger) + Vitest. See README for the full rationale.
