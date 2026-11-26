import argon2 from 'argon2';

import { Injectable, type OnModuleInit } from '@nestjs/common';

@Injectable()
export class PasswordHasher implements OnModuleInit {
  private dummyHash = '';

  async onModuleInit() {
    this.dummyHash = await this.hash('authentication-timing-equalizer');
  }

  hash(password: string) {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string | undefined, password: string) {
    const valid = await argon2.verify(hash ?? this.dummyHash, password);
    return hash !== undefined && valid;
  }
}
