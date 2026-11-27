import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';

import type { AppClsStore } from '../../common/context/app-cls-store.js';
import { AUTH_ERRORS, AuthException } from './auth.errors.js';
import { SessionResponseDto } from './dto/session.dto.js';
import { SessionStore } from './sessions/session.store.js';

/** The current user's sign-in sessions (profile → sign-in and security). */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionStore,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Active sessions of the current user, most recent first' })
  async list(): Promise<SessionResponseDto[]> {
    const current = this.cls.get('sessionId');
    const sessions = await this.sessions.list(this.userId());
    return sessions.map((session) => SessionResponseDto.from(session, current));
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Sign out one of the current user's sessions" })
  async revoke(@Param('sessionId', new ParseUUIDPipe()) sessionId: string): Promise<void> {
    if (!(await this.sessions.revokeOwn(this.userId(), sessionId))) {
      throw new AuthException(AUTH_ERRORS.SESSION_NOT_FOUND);
    }
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) {
      throw new AuthException(AUTH_ERRORS.SESSION_NOT_FOUND);
    }
    return userId;
  }
}
