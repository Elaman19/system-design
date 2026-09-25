# Agent rules for this project

- The task is not done until `npm run ci` is green. Do not report work as complete with a failing or skipped check.
- `npm run ci` = `db:test:up` (bootstraps `.env` from `.env.example` if missing, starts Postgres via Docker Compose, ensures the `app_test` database exists) + `typecheck` + `lint` + `format:check` + `test:cov`.
- Coverage thresholds (100% lines/branches/functions/statements) live in `vitest.config.ts` under `test.coverage.thresholds`. Do not lower them.
- Only exclude a file from coverage if it cannot be meaningfully unit-tested (e.g. `main.ts`, `data-source.ts`, migrations). Every exclusion in `vitest.config.ts` must carry a comment explaining why.
- Every class with a constructor-injected dependency (typed on a local class) compiles to include a `typeof X === 'undefined' ? Object : X` branch in its `design:paramtypes` metadata (TypeScript's `emitDecoratorMetadata`). This is real, reachable code (it guards against a circular import), not compiler noise — do not exclude it from coverage. Test it the way `src/app.controller.spec.ts` does: `vi.resetModules()`, `vi.doMock` the dependency's module to `undefined`, re-`import()` the class, and assert `Reflect.getMetadata('design:paramtypes', TheClass)` falls back to `Object`.
- Tests run against the `app_test` database (see `vitest.config.ts` `test.env`). Never point tests at the `app` (dev) database.
- Stack: NestJS (Express, `nest new` scaffold) + TypeORM (Postgres) + nestjs-pino (logger) + Vitest + oxlint. See README for the full rationale.
