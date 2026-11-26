import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from './auth.controller.js';
import { SessionDto } from './auth.dto.js';
import { SessionStore } from './session.store.js';

@ApiTags('profile')
@Controller('me/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionStore) {}

  @Get()
  @ApiOkResponse({ type: [SessionDto] })
  list(@Req() request: AuthenticatedRequest) {
    return this.sessions.list(request.user);
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) sessionId: string) {
    return this.sessions.revoke({ ...request.user, sessionId });
  }
}
