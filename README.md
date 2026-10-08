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
