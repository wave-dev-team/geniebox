/** Kysely instance on the app role (RLS enforced). Inject only into AccountDb. */
export const APP_KYSELY = Symbol('APP_KYSELY');
/** Kysely instance on the system role (BYPASSRLS). Inject only into SystemDb. */
export const SYSTEM_KYSELY = Symbol('SYSTEM_KYSELY');
