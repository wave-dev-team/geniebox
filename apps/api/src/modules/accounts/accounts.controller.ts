import type { Response } from 'express';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';

import { workspaceInviteSchema, workspaceJoinSchema, workspaceNameSchema } from '@workspace/types';

import type { AuthenticatedRequest } from '../../common/auth/request-actor.js';
import { selectWorkspace } from '../../common/auth/workspace-cookie.js';
import { AccountsService } from './accounts.service.js';

const inviteThrottle = { default: { limit: 12, ttl: 60_000 } };

@Controller('accounts')
export class AccountsController {
  private readonly secure: boolean;

  constructor(
    private readonly accounts: AccountsService,
    config: ConfigService,
  ) {
    this.secure = config.get('AUTH_COOKIE_SECURE') !== 'false' && config.get('NODE_ENV') === 'production';
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() request: AuthenticatedRequest) {
    return this.accounts.list(request.user);
  }

  @Post(':id/select')
  @HttpCode(204)
  async select(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.accounts.authorizeSelection(request.user, id);
    selectWorkspace(response, this.secure, request.user.userId, id);
  }

  @Patch('current')
  @HttpCode(204)
  rename(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = workspaceNameSchema.safeParse(body);
    if (!input.success) throw new BadRequestException();
    return this.accounts.rename(request.user, input.data.name);
  }

  @Get('current/members')
  @Header('Cache-Control', 'no-store')
  members(@Req() request: AuthenticatedRequest) {
    return this.accounts.members(request.user);
  }

  @Post('current/invitations')
  @Throttle(inviteThrottle)
  @HttpCode(204)
  invite(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = workspaceInviteSchema.safeParse(body);
    if (!input.success) throw new BadRequestException();
    return this.accounts.invite(request.user, input.data.email.toLowerCase());
  }

  @Post('join')
  @Throttle(inviteThrottle)
  @HttpCode(204)
  async join(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = workspaceJoinSchema.safeParse(body);
    if (!input.success) throw new BadRequestException();
    const tenantId = await this.accounts.join(request.user, input.data.code);
    selectWorkspace(response, this.secure, request.user.userId, tenantId);
  }
}
