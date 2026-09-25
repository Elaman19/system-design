# devin

NestJS backend with Postgres, Redis, OpenSearch and SeaweedFS (S3-compatible storage), running under Docker Compose.

## Stack and why

- **NestJS, scaffolded via `nest new`** — the Nest CLI generates the standard project layout (`nest-cli.json`, `tsconfig*.json`, `src/app.*`, `test/`) and wires up `nest build`/`nest start` against it, instead of hand-assembling that structure. That's the conventional starting point for a Nest app and what every other Nest developer will recognize.
- **Express, not Fastify, as the HTTP adapter** — the project uses `@nestjs/platform-express` (`NestFactory.create(AppModule)`), which is Nest's default platform. Fastify (`@nestjs/platform-fastify`, `NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())`) is a drop-in alternative at the Nest level and is generally faster with a schema-first validation model, but has a smaller ecosystem of ready-made middleware and a less common request/response API for anyone coming from plain Express. Nothing here is latency-sensitive enough to need Fastify's edge, so Express's larger ecosystem and familiarity win.
- **TypeORM** — official `@nestjs/typeorm` integration, decorator-based entities, CLI-driven migrations (`synchronize: false`; schema only ever changes through a migration).
- **oxlint, not ESLint** — a Rust-based linter that runs orders of magnitude faster than ESLint and covers the correctness/style rules this project needs (including type-aware checks via `oxlint-tsgolint`), at the cost of ESLint's much larger plugin ecosystem (e.g. framework-specific or highly custom rule sets). For a project this size, the speed is worth the smaller rule surface.
- **Prettier** — handles formatting only, kept separate from the linter so oxlint's rules stay about correctness, not style debates; `format:check` is the CI gate, `format` is the fix-it command.
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

- App: http://localhost:3000 (`GET /` → `Hello World!`, see `requests.http`)
- Postgres: localhost:5432
- Redis: localhost:6379
- OpenSearch: http://localhost:9200
- SeaweedFS S3 API: http://localhost:8333, filer UI: http://localhost:8888

`.env.example` is host-oriented (`localhost` for every service), for running the app or the TypeORM CLI directly on the host. The `app` service in `docker-compose.yml` overrides the vars it needs to reach its sibling containers by service name (`postgres`, `redis`, ...) instead.

## Development

```bash
npm install
docker compose up -d postgres redis opensearch seaweedfs
npm run start:dev
```

## Verification

```bash
npm run ci
```

This is the single command that must pass before any work is considered done: it starts a local Postgres via Docker Compose (bootstrapping `.env` from `.env.example` if it doesn't exist yet, so this works on a fresh clone), then runs type checking, linting, format checking and tests with a 100% coverage gate on lines/branches/functions/statements. See `AGENTS.md` for the rule and rationale, and `vitest.config.ts` for the coverage configuration (including the excluded files, each with a comment explaining why).

Tests run against a dedicated `app_test` database, isolated from the `app` database the running app uses. `db:test:ensure` (part of `db:test:up`/`ci`) creates `app_test` if it's missing, so this is safe to run even against a Postgres volume that already existed before `docker/postgres/init/01-create-test-db.sql` was added — that init script only runs on a brand-new volume.

## Migrations

```bash
npm run build   # entities/migrations are loaded from dist/, so build first
npm run migration:generate -- src/migrations/<Name>
npm run migration:run
```
