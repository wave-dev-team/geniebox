/** Category of a source; weights add up to the "team sees N% of the project" coverage. */
export const CONNECTION_CATEGORIES = {
  bot_crm: 30,
  payments: 25,
  site_analytics: 15,
  servers: 10,
  code: 10,
  database: 10,
} as const;
export type ConnectionCategory = keyof typeof CONNECTION_CATEGORIES;

export const ACCESS_LEVELS = ['read', 'read_write'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const FIELD_KINDS = ['secret', 'text', 'url', 'host', 'port', 'select'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export interface ProviderField {
  key: string;
  kind: FieldKind;
  required: boolean;
  /** For `select`. */
  options?: readonly string[];
  /** Default for optional fields (ports, ssl mode). */
  defaultValue?: string;
  pattern?: RegExp;
  maxLength?: number;
  /** Env names that usually hold this field, e.g. `YOOKASSA_SECRET_KEY`. Hints for import only. */
  envKeys?: readonly string[];
  aliases?: readonly string[];
}

/** Outcome of a check; `reason` is a stable code the UI translates. */
export type CheckReason =
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'UNREACHABLE'
  | 'TIMEOUT'
  | 'PRIVATE_HOST'
  | 'BAD_RESPONSE'
  | 'CHECK_FAILED'
  | 'SECRET_UNAVAILABLE';

export interface CheckResult {
  status: 'ok' | 'warn' | 'error';
  reason?: CheckReason;
  /** Short provider message for the user; must not contain secrets. */
  detail?: string;
  /** Non-secret facts learned during the check (bot username, account name). */
  configPatch?: Record<string, string>;
}

export interface CheckContext {
  config: Record<string, string>;
  secret: Record<string, string>;
  timeoutMs: number;
  allowPrivateHosts: boolean;
}

export interface ProviderDefinition {
  key: string;
  category: ConnectionCategory;
  /** Non-secret fields go to `connections.config`, secret ones are sealed. */
  fields: readonly ProviderField[];
  accessLevels: readonly AccessLevel[];
  /** The platform generates an SSH key pair; the public key is shown to the user. */
  sshKey?: boolean;
  /** Secret field shown masked (••••a91f). */
  maskField?: string;
  /** Prefix of the service's env variables, e.g. `YOOKASSA_`. A hint for import, never stored. */
  envPrefix?: string;
  aliases?: readonly string[];
  /** Where a person gets the credential, shown in the import preview. */
  docsUrl?: string;
  check(context: CheckContext): Promise<CheckResult>;
}
