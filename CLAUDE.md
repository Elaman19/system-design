# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

`AGENTS.md` (imported above) holds the binding rules: `npm run ci` must be green, 100% coverage thresholds, migration policy, test-database isolation, background-process conventions. The sections below add commands and architecture on top of it.

## Commands

```bash
npm run ci                  # the definition of "done": db:test:up + typecheck + lint + format:check + test:cov
npm run db:test:up          # start Compose backing services, recreate app_test empty, apply all migrations
npm run typecheck | lint | format | format:check
npm run test                # vitest run (needs db:test:up first: tests hit real Postgres/Redis/Kafka/S3/Mailpit)
npx vitest run test/marketplace/purchase.e2e-spec.ts            # one file
npx vitest run test/marketplace/purchase.e2e-spec.ts -t "name"  # one test
npm run start:dev           # app on the host (backing services from Compose, `docker compose up kafka-init` once for topics)
npm run build && npm run migration:run   # migrations load from dist/, so build first
docker compose up -d --build             # full stack: app + migrate + all background processes
```

- Unit tests are `src/**/*.spec.ts`; e2e tests are `test/**/*.e2e-spec.ts`. Both run through the same Vitest config against real services, not mocks.
- ESM project (`"type": "module"`): relative imports in TypeScript must end in `.js`.
- Docs, README, and code comments in docs are in Russian; code identifiers and source comments are English.

## Architecture

One NestJS codebase and one Docker image run as **several processes**. `src/main.ts` boots the HTTP API (`AppModule`). Every other process is a headless Nest application context started by a one-file entrypoint in `src/entrypoints/` through `runContext()` (config check → JSON logs → context → graceful shutdown → non-zero exit on `ProcessFailure` so Compose restarts it). Compose runs them as `node dist/entrypoints/<name>.js`:

| Process                | Does                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `app`                  | REST API: companies, lots, wallets, deals, health; emits Kafka view events          |
| `outbox-relay`         | moves `outbox` rows (written in the deal transaction) into the BullMQ `mail` queue  |
| `worker`               | consumes the `mail` queue: deal receipts, ban alerts, daily report                  |
| `clickstream-archiver` | Kafka `lot-views` → batched files in S3 (SeaweedFS), commit offset after the write  |
| `abuse-detector`       | `lot-views` → `ip-bans` when an IP exceeds 300 views/min (sliding window)           |
| `ban-recorder`         | `ip-bans` → Postgres `ip_bans` + alert job; `BanGuardModule` makes `app` answer 429 |
| `scheduler`            | cron for the daily report; **must run as exactly one copy**                         |

Entrypoints compose only the modules they need. `CoreModule` (env + logger + `ProcessFailure`) is in every process; `DatabaseModule` only in those that use Postgres (detector, archiver, scheduler deliberately don't open a pool). Add a new background process as a module in `src/` plus a one-line entrypoint and a Compose service.

### Data and consistency model

- **Postgres enforces the business rules**; services map violations to 4xx. Money invariants (ledger chain, balance = journal, append-only `deals`/`wallet_operations`/histories, stock chain, wallet required per company) are triggers, `CHECK`s and deferred constraints in `src/migrations/`. Read the migration, and `docs/db/README.md`, before changing a deal/wallet/lot write path. Error mapping: `src/db/pg-error.filter.ts` + `constraint-messages.ts`.
- **Purchases** lock with `SELECT ... FOR UPDATE` (lot, then wallets); stock changes are deltas, not absolute values. Connection-level `lock_timeout`/`statement_timeout` map to `409 RETRY`/`503 DB_TIMEOUT`.
- **Transactional outbox → BullMQ**: the deal transaction inserts into `outbox`/`deal_receipts`; the relay publishes at-least-once; deterministic job ids (`src/queue/jobs.ts`) dedupe in the queue and handlers are idempotent on their own. Two layers of idempotency is intentional.
- **Kafka** (`src/kafka/`, `@platformatic/kafka`): topics `lot-views` (key = client IP) and `ip-bans`, created by the one-shot `kafka-init` service via `ensureTopics`. Publishing a view event must never fail a request.
- Bigint balances are strings in API responses and compared via `BigInt`; ids are lower-cased by `src/common/uuid.ts`.
- Config is a zod schema in `src/config/env.ts`, validated at startup (invalid → one JSON `fatal` line, exit 1). New env vars need an entry in `.env.example` and, if tests depend on them, in `vitest.config.ts` `test.env`.

### Test seams

- `TxHooks` (`src/common/tx-hooks/`) is a no-op in production; tests override it to pause or fail a transaction at a named `TxPoint`, which is how races and rollbacks are reproduced. Waiting for a lock uses `pg_blocking_pids`, never `sleep`.
- `test/marketplace/helpers.ts` (`createHarness`, `createScratchHarness`) and `test/background/helpers.ts` (`startProcess`, `RecordingMailer`) are the entry points for new e2e tests. Per `AGENTS.md`, tests assert only on rows they created; anything that runs the relay needs a scratch database.
- Config for tests lives in `vitest.config.ts`: `test.env` sets `DB_NAME=app_test`, test-only `BULLMQ_PREFIX` and `KAFKA_GROUP_PREFIX`; `test/global-teardown.ts` deletes test Kafka topics.

## Documentation layout

Each course week adds to the same repo: `tasks/NN - *.md` (assignment) → code + `docs/system-design/marketplace-vN/` (growth map, ADRs) + `docs/architecture/*.drawio.svg` (C4 L1/L2/Deployment) + optional `docs/cheatsheet/*.md`. Topic write-ups live in `docs/db/README.md` and `docs/background/README.md`. `README.md` is the course README (stack rationale, acceptance tables, review notes), not a getting-started page alone. Do not mark manual items (mock interviews, live coding, fresh-session critic review) as done in acceptance tables.
