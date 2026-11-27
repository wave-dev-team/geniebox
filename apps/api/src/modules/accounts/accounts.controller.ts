import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccountsService } from './accounts.service.js';
import { AccountResponseDto, CreateAccountDto, UpdateAccountDto } from './dto/account.dto.js';
import { AccountAccessGuard } from './guards/account-access.guard.js';
import { ApiAccountParam } from './guards/api-account-param.decorator.js';
import { RequireAccountRole } from './guards/require-account-role.decorator.js';

@ApiTags('accounts')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an account; the caller becomes its owner' })
  async create(@Body() dto: CreateAccountDto): Promise<AccountResponseDto> {
    return AccountResponseDto.from(await this.accounts.create(dto));
  }

  @Get()
  @ApiOperation({ summary: 'Accounts the current user is a member of' })
  async list(): Promise<AccountResponseDto[]> {
    return (await this.accounts.listMine()).map((account) => AccountResponseDto.from(account));
  }

  @Get(':accountId')
  @ApiAccountParam()
  @UseGuards(AccountAccessGuard)
  @ApiOperation({ summary: 'Account details' })
  async get(): Promise<AccountResponseDto> {
    return AccountResponseDto.from(await this.accounts.getCurrent());
  }

  @Post(':accountId/manager-context/me/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiAccountParam()
  @UseGuards(AccountAccessGuard)
  @ApiOperation({ summary: 'Reset the caller’s manager conversation context in this account' })
  resetMyManagerContext(): Promise<void> {
    return this.accounts.resetManagerContext('personal');
  }

  @Post(':accountId/manager-context/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiAccountParam()
  @UseGuards(AccountAccessGuard)
  @RequireAccountRole('owner')
  @ApiOperation({ summary: 'Reset the manager context across the account (owner)' })
  resetAccountManagerContext(): Promise<void> {
    return this.accounts.resetManagerContext('account');
  }

  @Patch(':accountId')
  @ApiAccountParam()
  @UseGuards(AccountAccessGuard)
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Update account settings (admin)' })
  async update(@Body() dto: UpdateAccountDto): Promise<AccountResponseDto> {
    return AccountResponseDto.from(await this.accounts.updateCurrent(dto));
  }
}
