# Agent notes (apps/api)

- Backend lives in `apps/api`; the API is ESM (`"type": "module"`), relative imports use `.js` extensions.
- Never read `process.env` outside `src/config`. Account data only via `AccountDb`, the current user's data via `UserDb`; `SystemDb` only for cross-account platform work, with a written reason.
- Account = tenant. Account-scoped routes live under `/accounts/:accountId` behind `AccountAccessGuard`.
- Writes that must not be lost join the caller's transaction: `outbox.add(tx, ...)`, `journal.record(tx, ...)`. Long delays use `scheduledTasks.schedule(tx, ...)` plus a registered handler.
- New migration: add the file, register it in `src/database/migrations/index.ts`, run `pnpm db:migrate && pnpm db:types`.
- Before finishing: `pnpm --filter @workspace/api typecheck && pnpm --filter @workspace/api test` (and `build` when runtime files changed).
