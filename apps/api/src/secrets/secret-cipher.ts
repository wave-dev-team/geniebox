import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';

/**
 * Envelope encryption of connection secrets:
 * - every secret gets its own random 256-bit data key (DEK);
 * - the value is sealed with AES-256-GCM; the AAD binds it to its row
 *   (`account|project|credential`), so a ciphertext copied elsewhere fails to open;
 * - the DEK is wrapped with the key-encryption key (KEK), RSA-OAEP-SHA256.
 *
 * The KEK is asymmetric on purpose: processes that only store secrets (public API) hold the
 * public key; only the process that uses secrets (worker / tool executor) holds the private
 * key. A compromised API process can write secrets but never read them.
 */
export interface SealedSecret {
  /** iv (12) | auth tag (16) | ciphertext */
  ciphertext: Buffer;
  /** DEK wrapped by the KEK. */
  wrappedKey: Buffer;
  /** Which KEK wrapped the DEK; lets old secrets open after a KEK rotation. */
  kekId: string;
}

export const SECRET_SEALER = Symbol('SECRET_SEALER');
export const SECRET_OPENER = Symbol('SECRET_OPENER');

export interface SecretSealer {
  seal(plaintext: Buffer, aad: string): SealedSecret;
}

export interface SecretOpener {
  open(sealed: SealedSecret, aad: string): Buffer;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;
const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' } as const;

/** Stable id of a KEK: the first 16 hex chars of SHA-256 over its public key (SPKI DER). */
export function kekIdOf(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export class LocalSecretSealer implements SecretSealer {
  private readonly key: KeyObject;
  readonly kekId: string;

  constructor(publicKeyPem: string) {
    this.key = createPublicKey(publicKeyPem);
    if (this.key.asymmetricKeyType !== 'rsa') {
      throw new Error('Secrets KEK must be an RSA key');
    }
    this.kekId = kekIdOf(this.key);
  }

  seal(plaintext: Buffer, aad: string): SealedSecret {
    const dek = randomBytes(32);
    try {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', dek, iv);
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]),
        wrappedKey: publicEncrypt({ key: this.key, ...OAEP }, dek),
        kekId: this.kekId,
      };
    } finally {
      dek.fill(0);
    }
  }
}

export class LocalSecretOpener implements SecretOpener {
  private readonly keys = new Map<string, KeyObject>();

  constructor(privateKeyPems: string[]) {
    for (const pem of privateKeyPems) {
      const key = createPrivateKey(pem);
      this.keys.set(kekIdOf(createPublicKey(key)), key);
    }
    if (this.keys.size === 0) {
      throw new Error('At least one secrets private key is required to open secrets');
    }
  }

  open(sealed: SealedSecret, aad: string): Buffer {
    const key = this.keys.get(sealed.kekId);
    if (!key) {
      throw new Error(`Secrets KEK ${sealed.kekId} is not loaded`);
    }
    const dek = privateDecrypt({ key, ...OAEP }, sealed.wrappedKey);
    try {
      const iv = sealed.ciphertext.subarray(0, IV_BYTES);
      const tag = sealed.ciphertext.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const body = sealed.ciphertext.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', dek, iv);
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]);
    } finally {
      dek.fill(0);
    }
  }
}
