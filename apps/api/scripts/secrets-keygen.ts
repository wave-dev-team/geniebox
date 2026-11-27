import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { kekIdOf } from '../src/secrets/secret-cipher.js';

/**
 * Generates an RSA-3072 key pair for sealing connection secrets.
 * The public key goes to every process (SECRETS_PUBLIC_KEY_FILE); the private key only to the
 * worker (SECRETS_PRIVATE_KEY_FILES). Keep both outside the repository and the database host
 * backups. Usage: pnpm secrets:keygen [dir]   (default: ./.secrets)
 */
const dir = resolve(process.argv[2] ?? '.secrets');
mkdirSync(dir, { recursive: true, mode: 0o700 });

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
const id = kekIdOf(publicKey);
const publicFile = join(dir, 'kek.pub.pem');
const privateFile = join(dir, 'kek.key.pem');
writeFileSync(publicFile, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o444 });
writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o400 });

console.log(`KEK ${id}`);
console.log(`SECRETS_PUBLIC_KEY_FILE=${publicFile}`);
console.log(`SECRETS_PRIVATE_KEY_FILES=${privateFile}`);
