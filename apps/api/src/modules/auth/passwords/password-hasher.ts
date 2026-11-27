import argon2 from 'argon2';

import { Injectable, type OnModuleInit } from '@nestjs/common';

/** argon2id with library defaults (m=64MiB, t=3, p=4), above the OWASP minimum. */
@Injectable()
export class PasswordHasher implements OnModuleInit {
  // Verified against when the user does not exist, so timing does not reveal registered emails.
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash('timing-equalizer-not-a-real-password');
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    try {
      const ok = await argon2.verify(hash ?? this.dummyHash, password);
      return Boolean(hash) && ok;
    } catch {
      return false;
    }
  }
}
