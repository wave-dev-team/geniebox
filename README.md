# Geniebox

Каркас ИИ-помощника продукт-менеджера интернет-магазина. В интерфейсе есть разделы для гипотез, оценки релизов, источников, бэклога и метрик. Главная страница проверяет доступность API.

## Запуск через Docker Compose

Нужны Docker и Compose v2. Скопируйте `.env.example` в `.env` и задайте три независимых секрета. Для локального запуска можно сгенерировать каждый через `openssl rand -hex 32`.

- `POSTGRES_PASSWORD` используется владельцем базы.
- `DB_APP_PASSWORD` используется ролью `geniebox_app`.
- `JWT_SECRET` используется для проверки подписи токенов.

Заполните URL, подставив те же пароли вместо заполнителей. Для паролей со специальными символами используйте их URL-кодированное представление.

```dotenv
DB_MIGRATION_URL=postgresql://geniebox_owner:OWNER_PASSWORD@db:5432/geniebox
DATABASE_URL=postgresql://geniebox_app:APP_PASSWORD@db:5432/geniebox
```

```bash
docker compose up --build -d
curl -fsS http://127.0.0.1:3000/api/health
```

Интерфейс доступен по адресу <http://127.0.0.1:3000>. Caddy направляет `/api` в NestJS на том же origin. Сервис `migrate` создаёт роль приложения и применяет миграции до старта API. Контейнер API получает только URL роли приложения. При конфликте портов задайте `DB_PORT` или `WEB_PORT` в `.env`.

## Локальная разработка

Нужны Node.js 22 LTS и pnpm 10.32.1. В командах ниже замените `5432` на значение `DB_PORT`, если изменили его.

```bash
corepack enable
pnpm install --frozen-lockfile
docker compose up -d --wait db

set -a
. ./.env
set +a
export DB_MIGRATION_URL="${DB_MIGRATION_URL/@db:5432/@127.0.0.1:5432}"
export DATABASE_URL="${DATABASE_URL/@db:5432/@127.0.0.1:5432}"
pnpm exec turbo build --filter=@workspace/api
pnpm --filter @workspace/api db:bootstrap
pnpm --filter @workspace/api db:migrate
pnpm dev
```

Web по умолчанию слушает порт 3000 и проксирует локальный `/api` на порт 8000. Swagger доступен только в среде разработки по адресу <http://127.0.0.1:8000/api/docs>. Версионируемые маршруты API используют префикс `/api/v1`. Публичный `/api/health` проверяет состояние процесса. Остальные контроллеры защищены по умолчанию.

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration  # нужен Docker
pnpm audit --audit-level high
pnpm build
```

После новой миграции выполните `pnpm --filter @workspace/api db:types` с URL владельца базы и обновите сгенерированный тип схемы. Для просмотра состояния и отката последней миграции доступны `db:status` и `db:rollback`.

## Структура

| Путь                                          | Назначение                                                         |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `apps/web`                                    | Next.js App Router, навигация, локализованные строки и React Query |
| `apps/api`                                    | NestJS, Swagger, JWT guard, конфигурация и миграции Kysely         |
| `packages/ui`                                 | Компоненты shadcn/ui и токены Tailwind CSS                         |
| `packages/types`, `packages/api-client`       | Общий контракт и клиент HTTP                                       |
| `packages/tsconfig`, `packages/eslint-config` | Общие настройки TypeScript и ESLint                                |

Первая миграция создаёт каталог метрик с составным ключом тенанта и принудительным RLS. Пул приложения подключается отдельной ролью. `TenantDb` выставляет идентификатор тенанта только на время транзакции и берёт его из контекста запроса, который заполняет JWT-стратегия. Интеграционный тест проверяет изоляцию чтения и записи на PostgreSQL.

## Функциональность продукта

Следующий слой разработки включает:

- Адаптер Яндекс.Метрики и загрузку конкурентных исследований и интервью в закрытом контуре.
- Сопоставление сигналов с привязкой выводов к источникам и существующему бэклогу.
- Проверку гипотез и настройку критериев успеха, затем измерение эффекта после релиза.
- Экспорт задачи с тегом «сгенерирована ИИ-помощником» и уведомления продакт-менеджеру.

Доменные экраны на текущем этапе показывают пустые состояния. Вход пользователя, интеграции, агент и публикация стенда относятся к дальнейшей разработке.

## Сторонние компоненты

- Web — React, Next.js, Tailwind CSS, shadcn/ui CLI и пресет, Base UI, class-variance-authority, cn, Lucide, tw-animate-css, TanStack Query.
- API — NestJS, Express, Swagger, Terminus, Passport, passport-jwt, Throttler, Helmet, Kysely, pg, PostgreSQL, nestjs-cls, nestjs-i18n, nestjs-pino, pino-http, Zod, class-validator, class-transformer, reflect-metadata, RxJS.
- Сборка и проверки — pnpm, Turborepo, TypeScript, ESLint, typescript-eslint, simple-import-sort, Prettier, Husky, lint-staged, concurrently, Jest, ts-jest, Supertest, Testcontainers, kysely-codegen, Renovate, GitHub Actions, Docker Compose и Caddy.

Точные версии npm-пакетов перечислены в манифестах и `pnpm-lock.yaml`.
