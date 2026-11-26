import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppEnvironment } from '../config/environment.js';

@Injectable()
export class SecretCipher {
  private readonly key?: Buffer;
  constructor(config: ConfigService<AppEnvironment, true>) {
    const key = config.get('CONNECTIONS_ENCRYPTION_KEY', { infer: true });
    this.key = key ? Buffer.from(key, 'hex') : undefined;
  }

  get available() {
    return Boolean(this.key);
  }

  seal(context: readonly string[], value: string) {
    if (!this.key) throw new ServiceUnavailableException();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(context)));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }

  open(context: readonly string[], credential: string) {
    if (!this.key) throw new ServiceUnavailableException();
    try {
      const payload = Buffer.from(credential, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key, payload.subarray(0, 12));
      decipher.setAAD(Buffer.from(JSON.stringify(context)));
      decipher.setAuthTag(payload.subarray(12, 28));
      return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
