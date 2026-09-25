# devin

NestJS backend with Postgres, Redis, OpenSearch and SeaweedFS (S3-compatible storage), running under Docker Compose.

## Stack and why

- **NestJS** — the framework the project was scaffolded with.
- **TypeORM** — official `@nestjs/typeorm` integration, decorator-based entities, CLI-driven migrations (`synchronize: false`; schema only ever changes through a migration).
- **Vitest** — native ESM support without extra flags (this project uses `"type": "module"`), fast, and ships `coverage.thresholds` out of the box via `@vitest/coverage-v8`.
- **pino via `nestjs-pino`** — structured JSON logs (ready to ship to OpenSearch), the fastest logger in the Node ecosystem, replaces Nest's built-in logger; `pino-pretty` is used only when `NODE_ENV=development`.
- **OpenSearch** instead of Elasticsearch — Apache 2.0 licensed, security plugin is trivial to disable for local/dev use.
- **SeaweedFS** instead of MinIO — `minio/minio` now requires a Docker Hub login to pull; SeaweedFS's S3 gateway (`chrislusf/seaweedfs`) is a freely pullable, actively maintained S3-compatible alternative.
- **Node 24 LTS** (`node:24-alpine`) — current Active LTS.

Redis, OpenSearch and SeaweedFS are provisioned in Compose and reachable via env vars from day one; the app doesn't have clients wired up for them yet — those get added when a feature needs them.

## Running the stack

```bash
cp .env.example .env
docker compose up -d --build
```

- App: http://localhost:3000 (`GET /` → `Hello World!`)
- Postgres: localhost:5432
- Redis: localhost:6379
- OpenSearch: http://localhost:9200
- SeaweedFS S3 API: http://localhost:8333, filer UI: http://localhost:8888

## Development

```bash
npm install
npm run start:dev
```

## Verification

```bash
npm run ci
```

This is the single command that must pass before any work is considered done: it starts a local Postgres via Docker Compose, then runs type checking, linting, format checking and tests with a coverage gate (100% on lines/statements/functions; branches is 100% except for one documented, structurally-unreachable exception). See `AGENTS.md` for the rule and rationale, and `vitest.config.ts` for the coverage configuration (including the excluded files and the branch-threshold exception, each with a comment explaining why).

Tests run against a dedicated `app_test` database (created by `docker/postgres/init/01-create-test-db.sql`), never against the `app` database used by the running app.

## Migrations

```bash
npm run migration:generate -- src/migrations/<Name>
npm run migration:run
```
