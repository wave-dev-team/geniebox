import { readFileSync } from 'node:fs';

import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.schema.js';
import { LocalSecretOpener, LocalSecretSealer, SECRET_OPENER, SECRET_SEALER } from './secret-cipher.js';

const KEYGEN_HINT = 'generate a key pair with `pnpm secrets:keygen`';

function readKey(path: string, what: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read secrets ${what} at ${path}: ${KEYGEN_HINT}`, { cause: error });
  }
}

/** Sealing only (public KEK): any process that stores secrets, including the public API. */
@Global()
@Module({
  providers: [
    {
      provide: SECRET_SEALER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new LocalSecretSealer(readKey(config.get('SECRETS_PUBLIC_KEY_FILE', { infer: true }), 'public key')),
    },
  ],
  exports: [SECRET_SEALER],
})
export class SecretsModule {}

/**
 * Opening (private KEK): the worker only — it runs connection checks and the tool executor.
 * Never import this into the API processes.
 */
@Global()
@Module({
  providers: [
    {
      provide: SECRET_OPENER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const files = config.get('SECRETS_PRIVATE_KEY_FILES', { infer: true });
        if (files.length === 0) {
          throw new Error(`SECRETS_PRIVATE_KEY_FILES is required in the worker: ${KEYGEN_HINT}`);
        }
        return new LocalSecretOpener(files.map((file) => readKey(file, 'private key')));
      },
    },
  ],
  exports: [SECRET_OPENER],
})
export class SecretsOpenerModule {}
