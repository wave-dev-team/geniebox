import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { AppRedis } from '../../common/redis/app-redis.js';

const attemptScript = `
local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then redis.call('EXPIRE', KEYS[1], 900) end
return attempts
`;

@Injectable()
export class LoginAttempts {
  constructor(private readonly redis: AppRedis) {}

  async claim(emailKey: string) {
    const attempts = await this.redis.client.eval(attemptScript, 1, this.key(emailKey));
    if (typeof attempts !== 'number' || attempts > 10) {
      throw new HttpException('Too many attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async reset(emailKey: string) {
    await this.redis.client.del(this.key(emailKey));
  }

  private key(emailKey: string) {
    return `auth:login-attempts:${emailKey}`;
  }
}
