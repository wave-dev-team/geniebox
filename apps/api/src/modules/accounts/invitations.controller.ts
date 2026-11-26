import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AcceptInvitationDto,
  AccountResponseDto,
  CreateInvitationDto,
  InvitationResponseDto,
} from './dto/account.dto.js';
import { AccountAccessGuard } from './guards/account-access.guard.js';
import { ApiAccountParam } from './guards/api-account-param.decorator.js';
import { RequireAccountRole } from './guards/require-account-role.decorator.js';
import { InvitationsService } from './invitations.service.js';

@ApiTags('account invitations')
@ApiBearerAuth()
@UseGuards(AccountAccessGuard)
@RequireAccountRole('admin')
@ApiAccountParam()
@Controller('accounts/:accountId/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @ApiOperation({ summary: 'Invite by email (admin); replaces a pending invite for that email' })
  async create(@Body() dto: CreateInvitationDto): Promise<InvitationResponseDto> {
    return InvitationResponseDto.from(await this.invitations.create(dto.email, dto.role));
  }

  @Get()
  @ApiOperation({ summary: 'Pending invitations (admin)' })
  async list(): Promise<InvitationResponseDto[]> {
    return (await this.invitations.listPending()).map((row) => InvitationResponseDto.from(row));
  }

  @Delete(':invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a pending invitation (admin)' })
  async revoke(@Param('invitationId', new ParseUUIDPipe()) invitationId: string): Promise<void> {
    await this.invitations.revoke(invitationId);
  }
}

@ApiTags('account invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationAcceptanceController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an invitation; requires a verified email matching the invite' })
  async accept(@Body() dto: AcceptInvitationDto): Promise<AccountResponseDto> {
    return AccountResponseDto.from(await this.invitations.accept(dto.token));
  }
}
