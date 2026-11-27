# Geniebox backend

NestJS + Kysely + PostgreSQL, BullMQ + Redis. Аккаунт — тенант: маршруты живут под
`/v1/accounts/:accountId/projects/:projectId`, изоляция данных обеспечивается RLS.

## Процессы

Один образ, три entrypoint-а:

| Процесс  | Entry                   | Слушает                       | Назначение                                            |
| -------- | ----------------------- | ----------------------------- | ----------------------------------------------------- |
| api      | `dist/main.js`          | `PUBLIC_HOST:PUBLIC_PORT`     | Публичный API, Swagger в development                  |
| internal | `dist/main.internal.js` | `INTERNAL_HOST:INTERNAL_PORT` | `/health/details`, только приватная сеть              |
| worker   | `dist/main.worker.js`   | —                             | Outbox relay, очереди, планировщик, агентский runtime |

## Быстрый старт

Нужны Docker и Compose v2.

```bash
cp .env.example apps/api/.env
(cd apps/api && pnpm secrets:keygen)
docker compose up --build -d --wait
curl -fsS http://127.0.0.1:3000/health
```

- API: <http://127.0.0.1:3000>, Swagger: <http://127.0.0.1:3000/docs>
- Internal: <http://127.0.0.1:3100/health/details>
- Mailpit: <http://127.0.0.1:8025>
- Postgres: `localhost:5432` (`postgres` / `postgres`)
- Redis state/cache: `localhost:6379` / `localhost:6380`

Сервис `migrate` создаёт роли БД и применяет миграции до старта приложений.
Пересоберите образ после изменения кода: `docker compose up --build -d`.

## Локальная разработка без контейнеров приложений

Нужны Node.js 22 и pnpm 10.32.1.

```bash
corepack enable
pnpm install
docker compose up -d --wait postgres redis-state redis-cache mail

cd apps/api
set -a; . ./.env; set +a
pnpm build
node dist/database/cli.js bootstrap
node dist/database/cli.js migrate
pnpm start          # API на :3000
pnpm start:internal # /health/details на :3100
pnpm start:worker   # очереди и runtime
```

Секреты подключений — RSA-пара в `apps/api/.secrets`; приватный ключ читает только worker.
Сгенерировать: `cd apps/api && pnpm secrets:keygen`.

## База данных

```bash
cd apps/api
pnpm db:bootstrap    # роли и база (нужен DATABASE_ADMIN_URL)
pnpm db:migrate
pnpm db:status
pnpm db:rollback     # только обратимая последняя миграция
pnpm db:types        # regenerated src/database/types.ts из схемы
```

Роли фиксированы (`src/database/roles.ts`): `geniebox_owner` (миграции),
`geniebox_app` (запросы, RLS, без `BYPASSRLS`), `geniebox_system` (`BYPASSRLS`,
кросс-аккаунтные задачи).

Доступ к данным аккаунта — только через `AccountDb.transaction`; данные пользователя
вне аккаунта — `UserDb`; `SystemDb` — только с обоснованной причиной.

## Проверки

```bash
pnpm --filter @workspace/api typecheck
pnpm --filter @workspace/api build
pnpm --filter @workspace/api test
pnpm --filter @workspace/api test:integration   # Testcontainers, нужен Docker
```

## База знаний

Проект имеет дерево знаний: источники (файлы и вставленный текст) → черновые страницы,
которые человек правит и публикует → поисковый индекс. Агенты видят только опубликованные
страницы и предлагают изменения, которые подтверждает человек. Решение и схема —
`docs/adr/0001-knowledge-base.md` и `docs/prd/knowledge-base.md`.

PostgreSQL работает на образе `pgvector/pgvector:pg17`: расширения `vector` и `pg_trgm`
создаются при bootstrap базы. Поиск гибридный — полнотекстовый (русская конфигурация),
векторный и точные совпадения по названию, слияние по Reciprocal Rank Fusion.

Импорт: `.md`, `.txt`, `.csv`, `.xlsx` (до 20 МБ). PDF и DOCX — следующий шаг. Разбор XLSX
выполняет [ExcelJS](https://github.com/exceljs/exceljs) (MIT), остальные форматы — код
проекта. Файлы лежат вне корня веб-сервера в `KNOWLEDGE_BLOB_DIR` (том `knowledge-data`).

Эмбеддинги — OpenAI `text-embedding-3-small` (1536 измерений) через `EMBEDDING_*`.
`EMBEDDING_PROVIDER=none` оставляет поиск на полнотекстовом, `fake` — офлайн-режим для
разработки и тестов. Провайдер не обучается на переданных данных; загруженные источники
никогда не публикуются в этом репозитории.

Демо-данные загружаются локально, датасет организаторов в репозиторий не входит:

```bash
cd apps/api
KNOWLEDGE_BLOB_DIR=./data/knowledge \
  pnpm exec tsx scripts/seed-knowledge.ts \
  --account <uuid> --project <uuid> --dir ../../context/tz/materials
```

## Структура

```text
apps/api/src
  config/        zod-схема env — единственное место чтения process.env
  bootstrap/     настройка HTTP-приложения
  common/        CLS-контекст, исключения, фильтр, guards, i18n, логи, Redis, throttler
  database/      Kysely, AccountDb/UserDb/SystemDb, роли, bootstrap, миграции, types.ts
  journal/       неизменяемый журнал действий
  outbox/        transactional outbox + relay/processor в worker
  scheduling/    scheduled_tasks в Postgres + sweeper и run processor
  queues/        имена очередей и политики ретраев
  modules/       accounts, projects, agents, work, connections, metrics, knowledge,
                 runtime, stream, mail, catalog, actions, health, users, auth
apps/api/test    e2e-тесты (Testcontainers)
```

## Локальный фронтенд

При работающем API и worker запустите из корня монорепозитория:

```bash
pnpm --filter @workspace/types build
pnpm --filter @workspace/api-client build
pnpm --filter @workspace/web dev
```

Откройте <http://localhost:3001>. Письма регистрации, входа и восстановления доступны в
[Mailpit](http://localhost:8025). Next.js обращается к API по адресу
`http://127.0.0.1:3000`. Для другого адреса задайте `API_BASE_URL` в окружении веб-приложения.

В настройках можно создать аккаунт или принять приглашение. Для первого диалога
создайте проект в выбранном аккаунте. Worker создаёт управляющего проекта и передаёт
ответы через SSE. В локальном Compose используется провайдер `fake`.

## Production release

Merging to `main` publishes the API and web images and runs the production workflow.
Set `OPENAI_API_KEY` in `/opt/wave/shared/.env` on the deployment server before merging.
The runtime uses the OpenAI Chat Completions API and defaults to `gpt-4.1-mini`.
An approved OpenAI-compatible provider can be configured with `OPENAI_BASE_URL` and
`LLM_MODEL`. The same server file supplies the SMTP settings and JWT secret.

The release script provisions the database roles, the runtime secrets, and separate
PostgreSQL and Redis volumes. The previous deployment’s database and Redis volumes are retained
for rollback.
