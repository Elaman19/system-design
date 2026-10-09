# system-design

Бэкенд на NestJS с Postgres, Redis, OpenSearch и SeaweedFS (S3-совместимое хранилище), запускается через Docker Compose.

## Стек и почему

- **NestJS, созданный через `nest new`** — Nest CLI генерирует стандартную структуру проекта (`nest-cli.json`, `tsconfig*.json`, `src/app.*`, `test/`) и настраивает `nest build`/`nest start`, вместо ручной сборки этой структуры. Это привычная отправная точка для Nest-приложения, знакомая любому Nest-разработчику.
- **Express, а не Fastify, как HTTP-адаптер** — проект использует `@nestjs/platform-express` (`NestFactory.create(AppModule)`), то есть платформу Nest по умолчанию. Fastify (`@nestjs/platform-fastify`, `NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())`) на уровне Nest заменяется без переделок и обычно быстрее благодаря валидации по схеме, но экосистема готовых middleware у него меньше, а API запроса и ответа менее привычен тем, кто пришёл с чистого Express. Здесь нет задержек, критичных настолько, чтобы нуждаться в преимуществе Fastify, поэтому выигрывают большая экосистема и знакомство с Express.
- **TypeORM** — официальная интеграция `@nestjs/typeorm`, сущности на декораторах, миграции через CLI (`synchronize: false`; схема меняется только миграцией).
- **oxlint, а не ESLint** — линтер на Rust, который работает на порядки быстрее ESLint и покрывает нужные проекту правила корректности и стиля (включая проверки с учётом типов через `oxlint-tsgolint`). Платой за это стала куда меньшая экосистема плагинов ESLint (например, правила для фреймворков или сильно кастомные наборы). Для проекта такого размера скорость важнее.
- **Prettier** — отвечает только за форматирование и отделён от линтера, чтобы правила oxlint касались корректности, а не споров о стиле; `format:check` — проверка в CI, `format` — команда для исправления.
- **Vitest** — нативная поддержка ESM без дополнительных флагов (проект использует `"type": "module"`), быстрый, а `coverage.thresholds` идут из коробки вместе с `@vitest/coverage-v8`.
- **pino через `nestjs-pino`** — структурированные JSON-логи (готовы к отправке в OpenSearch), самый быстрый логгер в экосистеме Node, заменяет встроенный логгер Nest; `pino-pretty` используется только при `NODE_ENV=development`.
- **OpenSearch** вместо Elasticsearch — лицензия Apache 2.0, плагин безопасности для локальной разработки отключается без усилий.
- **SeaweedFS** вместо MinIO — `minio/minio` теперь требует входа в Docker Hub для загрузки; S3-шлюз SeaweedFS (`chrislusf/seaweedfs`) свободно скачивается, активно поддерживается и совместим с S3.
- **Node 24 LTS** (`node:24-alpine`) — текущая Active LTS.

Redis, OpenSearch и SeaweedFS поднимаются в Compose и доступны через переменные окружения с самого начала; клиенты для них в приложении пока не подключены, их добавят, когда они понадобятся какой-нибудь функции.

## Запуск стека

```bash
cp .env.example .env
docker compose up -d --build
```

- Приложение: http://localhost:3000 (`GET /` → `Hello World!`, см. `requests.http`)
- Postgres: localhost:5432
- Redis: localhost:6379
- OpenSearch: http://localhost:9200
- S3 API SeaweedFS: http://localhost:8333, UI filer: http://localhost:8888

`.env.example` рассчитан на хост (для каждого сервиса указан `localhost`), чтобы запускать приложение или TypeORM CLI прямо на хосте. Сервис `app` в `docker-compose.yml` переопределяет нужные переменные, чтобы обращаться к соседним контейнерам по имени сервиса (`postgres`, `redis`, ...).

## Разработка

```bash
npm install
docker compose up -d postgres redis opensearch seaweedfs
npm run start:dev
```

## Проверка

Нужен Docker Compose v2 с поддержкой `up --wait`; Compose v1 эту проверку не поддерживает.

```bash
npm run ci
```

Это единственная команда, которая должна проходить, прежде чем работа считается завершённой: она запускает локальный Postgres через Docker Compose (создаёт `.env` из `.env.example`, если его ещё нет, поэтому работает на свежем клоне), затем выполняет проверку типов, линтинг, проверку форматирования и тесты с порогом покрытия 100% по строкам, ветвям, функциям и операторам. Правило и его обоснование — в `AGENTS.md`, настройки покрытия (включая исключённые файлы, у каждого из которых есть комментарий с причиной) — в `vitest.config.ts`.

Тесты идут на отдельной базе `app_test`, изолированной от базы `app`, с которой работает запущенное приложение. `db:test:ensure` (входит в `db:test:up`/`ci`) создаёт `app_test`, если её нет, поэтому запускать безопасно даже на томе Postgres, который существовал до добавления `docker/postgres/init/01-create-test-db.sql`: этот init-скрипт выполняется только на совершенно новом томе.

## Cloud native / 12factor

Контейнер одноразовый: платформа гасит и поднимает его когда хочет.

- **Конфиг** — только из переменных окружения, схема на zod в `src/config/env.ts` проверяется при старте (`main.ts`). Не хватает обязательной переменной — приложение пишет одну JSON-строку `fatal` с именами полей и завершается с кодом 1, не поднимая Nest. В репозитории только `.env.example`.
- **`GET /live`** — liveness, без зависимостей. **`GET /ready`** — readiness на `@nestjs/terminus`: пинг Postgres с таймаутом `HEALTH_TIMEOUT_MS` и индикатор `shutdown`. `healthcheck` в `docker-compose.yml` вызывает `/ready`. Compose не перезапускает unhealthy-контейнер: при падении базы приложение становится `unhealthy`, а когда база вернулась — снова `healthy`, без рестарта.
- **Graceful shutdown** (`src/health/shutdown.service.ts`), порядок хуков Nest: `onModuleDestroy` → `beforeApplicationShutdown(SIGTERM)` → закрытие HTTP-сервера → `onApplicationShutdown`.
  1. `onModuleDestroy` ставит флаг — `/ready` сразу отвечает 503; `beforeApplicationShutdown` ждёт `SHUTDOWN_DRAIN_MS`, чтобы балансировщик снял трафик (остальные запросы ещё обслуживаются);
  2. закрываем listener (новые соединения не принимаются), ждём текущие запросы до `SHUTDOWN_TIMEOUT_MS`, затем принудительно рвём оставшиеся;
  3. `onApplicationShutdown`: закрываем соединения с базой — только после ответа на последний запрос. `TypeOrmCoreModule` делает то же самое в своём хуке; наш хук нужен ради явного лога и идемпотентен (`isInitialized`).

  `stop_grace_period` в compose (30s) должен быть больше `SHUTDOWN_DRAIN_MS + SHUTDOWN_TIMEOUT_MS`.

- **Логи** — pino, JSON в stdout, у каждого запроса `req.id` (берётся из входящего `x-request-id` или генерируется, возвращается в заголовке ответа). Пробы `/live` и `/ready` не логируются.

### Проверка руками

```bash
docker compose up -d --build

# зависимость упала и вернулась: /ready 503 с именем database, /live 200, без рестарта
docker compose stop postgres
curl -i localhost:3000/ready; curl -i localhost:3000/live
docker compose start postgres
docker inspect -f '{{.State.StartedAt}}' $(docker compose ps -q app)   # не менялось

# graceful shutdown под нагрузкой: ни одного оборванного запроса
node scripts/load.mjs http://localhost:3000 5 &
docker compose stop app
docker compose logs app | grep ShutdownService   # какие хуки и в каком порядке
```

`GET /work` включается `WORK_ENDPOINT_ENABLED=true` (в `.env.example` и compose включён; по умолчанию выключен — 404). Каждый запрос держит соединение из пула pg (по умолчанию 10), поэтому в `scripts/load.mjs` держите concurrency ниже размера пула, иначе `/ready` может упереться в `HEALTH_TIMEOUT_MS`. Скрипт завершается с кодом 1, если хоть один запрос оборвался на полуслове или получил не-2xx.

## Домашка 02 — экосистема Node.js

- **Презентация** «Node.js vs Java»: https://claude.ai/artifact/PEHouDxMP8BRYrUsCc9anV
- **Шпаргалка**: [docs/cheatsheet.md](docs/cheatsheet.md)
- **Системный дизайн**: [docs/cheatsheet-sd.md](docs/cheatsheet-sd.md)
- **Эксперимент** (один процесс / `cluster` / `worker_threads`): [experiments/02-event-loop](experiments/02-event-loop)

## Миграции

```bash
npm run build   # сущности и миграции загружаются из dist/, поэтому сначала сборка
npm run migration:generate -- src/migrations/<Name>
npm run migration:run
```
