import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ChangeRoleDto, MemberResponseDto, TransferOwnershipDto } from './dto/account.dto.js';
import { AccountAccessGuard } from './guards/account-access.guard.js';
import { ApiAccountParam } from './guards/api-account-param.decorator.js';
import { RequireAccountRole } from './guards/require-account-role.decorator.js';
import { MembersService } from './members.service.js';

@ApiTags('account members')
@ApiBearerAuth()
@UseGuards(AccountAccessGuard)
@ApiAccountParam()
@Controller('accounts/:accountId')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get('members')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'List members (tech and above; viewers do not see the team)' })
  async list(): Promise<MemberResponseDto[]> {
    return (await this.members.list()).map((member) => MemberResponseDto.from(member));
  }

  @Patch('members/:userId')
  @RequireAccountRole('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Change a member's role (admin; other admins: owner)" })
  async changeRole(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: ChangeRoleDto,
  ): Promise<void> {
    await this.members.changeRole(userId, dto.role);
  }

  @Delete('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member (admin) or leave the account (self)' })
  async remove(@Param('userId', new ParseUUIDPipe()) userId: string): Promise<void> {
    await this.members.remove(userId);
  }

  @Post('ownership')
  @RequireAccountRole('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Transfer ownership to another member; the owner becomes admin' })
  async transferOwnership(@Body() dto: TransferOwnershipDto): Promise<void> {
    await this.members.transferOwnership(dto.userId);
  }
}
