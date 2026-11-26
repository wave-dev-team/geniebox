import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { JwtStrategy } from '../../common/auth/jwt.strategy.js';
import { ProfileModule } from '../profile/profile.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRedis } from './auth-redis.js';
import { EmailCodesService } from './email-codes.service.js';
import { LoginAttempts } from './login-attempts.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionStore } from './session.store.js';
import { SessionsController } from './sessions.controller.js';

@Module({
  imports: [
    ProfileModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [AuthController, SessionsController],
  providers: [
    AuthService,
    AuthRedis,
    EmailCodesService,
    LoginAttempts,
    PasswordHasher,
    SessionStore,
    JwtStrategy,
  ],
})
export class AuthModule {}
