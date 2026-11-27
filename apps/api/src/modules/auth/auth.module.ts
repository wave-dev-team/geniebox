import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import type { Env } from '../../config/env.schema.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EmailCodeStore } from './codes/email-code.store.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { LoginAttemptsLimiter } from './login-attempts.limiter.js';
import { OidcVerifier } from './oidc/oidc-verifier.js';
import { PasswordHasher } from './passwords/password-hasher.js';
import { SessionsController } from './sessions.controller.js';
import { SessionStore } from './sessions/session.store.js';
import { AccessTokenService } from './tokens/access-token.service.js';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
      }),
    }),
  ],
  controllers: [AuthController, SessionsController],
  providers: [
    AuthService,
    PasswordHasher,
    SessionStore,
    AccessTokenService,
    EmailCodeStore,
    LoginAttemptsLimiter,
    OidcVerifier,
    AccessTokenGuard,
  ],
  // The guard is registered globally by the public API module.
  exports: [
    AccessTokenGuard,
    AccessTokenService,
    SessionStore,
    PasswordHasher,
    LoginAttemptsLimiter,
    EmailCodeStore,
    AuthService,
    JwtModule,
  ],
})
export class AuthModule {}
