# Geniebox

Каркас ИИ-помощника продукт-менеджера интернет-магазина. В интерфейсе есть разделы для гипотез, оценки релизов, источников, бэклога и метрик. Главная страница содержит форму запроса к помощнику.

## Запуск через Docker Compose

Нужны Docker и Compose v2. Скопируйте `.env.example` в `.env` и задайте четыре независимых секрета. Для локального запуска можно сгенерировать каждый через `openssl rand -hex 32`.

- `POSTGRES_PASSWORD` используется владельцем базы.
- `DB_APP_PASSWORD` используется ролью `geniebox_app`.
- `JWT_SECRET` используется для подписи токенов.
- `AUTH_IDENTITY_SECRET` используется для индекса входа по email и проверки одноразовых кодов. Сохраняйте его вместе с резервной копией базы.
- В локальном Compose используются Redis для сессий и Mailpit для писем. Откройте <http://127.0.0.1:8025>, чтобы получить код подтверждения, входа или сброса пароля.

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
docker compose up -d --wait db redis mail

set -a
. ./.env
set +a
export DB_MIGRATION_URL="${DB_MIGRATION_URL/@db:5432/@127.0.0.1:5432}"
export DATABASE_URL="${DATABASE_URL/@db:5432/@127.0.0.1:5432}"
export REDIS_URL="${REDIS_URL/redis:6379/127.0.0.1:6379}"
export SMTP_URL="${SMTP_URL/mail:1025/127.0.0.1:1025}"
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

Доступны регистрация, вход по паролю или коду из письма, подтверждение адреса, восстановление пароля, управление профилем и сеансами, светлая, тёмная и системная темы. Главная показывает форму помощника и примеры запросов. Отправка ведёт на заглушку диалога. Доменные разделы, Telegram и уведомления показывают заглушки.

Access JWT живёт 10 минут и хранится в HttpOnly cookie. Refresh действует до 30 дней, ротируется в Redis и отзывается при завершении сеанса. PostgreSQL хранит профили под принудительным RLS. Глобальный индекс входа хранит HMAC адреса и идентификаторы тенанта и пользователя. Миграция профилей необратима из-за риска потери учётных записей.

## Сторонние компоненты

- Web — React, Next.js, Tailwind CSS, shadcn/ui CLI и пресет, Base UI, class-variance-authority, cn, Lucide, tw-animate-css, TanStack Query, React Hook Form, Hook Form Resolvers, next-intl, next-themes, Sonner, cmdk и input-otp.
- API — NestJS, Express, Swagger, Terminus, Passport, passport-jwt, Throttler, Helmet, Kysely, pg, PostgreSQL, nestjs-cls, nestjs-i18n, nestjs-pino, pino-http, Zod, class-validator, class-transformer, reflect-metadata, RxJS, @nestjs/jwt, Redis, ioredis, Argon2, Nodemailer и Mailpit для локальной почты.
- Сборка и проверки — pnpm, Turborepo, TypeScript, ESLint, typescript-eslint, simple-import-sort, Prettier, Husky, lint-staged, concurrently, Jest, ts-jest, Supertest, Testcontainers, kysely-codegen, Renovate, GitHub Actions, Docker Compose и Caddy.

Точные версии npm-пакетов перечислены в манифестах и `pnpm-lock.yaml`.

## Продакшен

Перед первым развёртыванием версии с авторизацией задайте `SMTP_URL` и `AUTH_MAIL_FROM` в `/opt/wave/shared/.env`. Скрипт первого развёртывания добавляет `AUTH_IDENTITY_SECRET`, если переменная отсутствует. Данные Redis сохраняются в отдельном томе.

Слияние в `main` запускает workflow **Deploy production**. Он публикует образы API и web в GHCR с тегом SHA коммита, применяет миграции на стенде и проверяет публичный URL <https://app.geniebox.ru> и health endpoint <https://app.geniebox.ru/api/health>. Стенд принимает публичные запросы через Caddy, а порты приложений доступны только на loopback.

Окружение GitHub `production` разрешает деплой из `main` и содержит `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` и `DEPLOY_KNOWN_HOSTS`. На первом запуске workflow создаёт конфигурацию БД в `/opt/wave/shared/.env`. Эта конфигурация и том PostgreSQL используются во всех следующих релизах.

При провале проверки workflow возвращает предыдущие образы приложения, если они доступны. Изменения схемы БД сохраняются, поэтому релизные миграции должны быть совместимы с предыдущей версией приложения. Для планового отката оформите revert через PR в `main`.
