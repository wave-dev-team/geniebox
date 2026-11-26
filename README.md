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
  modules/       accounts, projects, agents, work, connections, metrics, runtime, stream,
                 mail, catalog, actions, health, users, auth
apps/api/test    e2e-тесты (Testcontainers)
```

## Клиенты

- `apps/web` и `packages/api-client` — отдельные клиентские пакеты; их совместимость с
  текущим API отдельно не гарантируется.
