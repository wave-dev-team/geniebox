import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.schema.js';

const KEY_PART = /^[A-Za-z0-9_-]{1,80}$/;
const KEY_FILE = /^([a-f0-9]{64})\.([a-z0-9]{1,8})$/;

/**
 * Uploaded sources on local disk (a docker volume in every environment). Keys are content
 * addresses, so writing the same bytes twice is a no-op and nothing is ever overwritten
 * with different content. Swapping to S3/MinIO later keeps the same interface.
 */
@Injectable()
export class BlobStore {
  private readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = resolve(config.get('KNOWLEDGE_BLOB_DIR', { infer: true }));
  }

  keyFor(accountId: string, projectId: string, sha256: string, ext: string): string {
    return `${accountId}/${projectId}/${sha256}.${ext}`;
  }

  /** Writes through a temporary file: a reader never sees a half-written source. */
  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, data, { mode: 0o600 });
    try {
      await rename(temp, path);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.pathFor(key)).catch(() => undefined);
  }

  /** Rejects anything that is not a well-formed key: no traversal, no absolute paths. */
  private pathFor(key: string): string {
    const parts = key.split('/');
    const file = parts.pop() ?? '';
    if (parts.length !== 2 || !parts.every((part) => KEY_PART.test(part)) || !KEY_FILE.test(file)) {
      throw new Error('invalid blob key');
    }
    const path = join(this.root, ...parts, file);
    if (!path.startsWith(`${this.root}/`)) throw new Error('invalid blob key');
    return path;
  }
}
