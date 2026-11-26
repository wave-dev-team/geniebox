import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { AuthRedis } from './auth-redis.js';

const attemptScript = `
local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then redis.call('EXPIRE', KEYS[1], 900) end
return attempts
`;

@Injectable()
export class LoginAttempts {
  constructor(private readonly redis: AuthRedis) {}

  async claim(emailKey: string) {
    const attempts = await (await this.redis.get()).eval(attemptScript, 1, this.key(emailKey));
    if (typeof attempts !== 'number' || attempts > 10) {
      throw new HttpException('Too many attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async reset(emailKey: string) {
    await (await this.redis.get()).del(this.key(emailKey));
  }

  private key(emailKey: string) {
    return `auth:login-attempts:${emailKey}`;
  }
}
