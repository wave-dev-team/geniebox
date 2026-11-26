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

import { Public } from '../../common/decorators/public.decorator.js';
import { StrictThrottle } from '../../common/throttler/strict-throttle.decorator.js';
import { AccountAccessGuard } from '../accounts/guards/account-access.guard.js';
import { ApiAccountParam } from '../accounts/guards/api-account-param.decorator.js';
import { RequireAccountRole } from '../accounts/guards/require-account-role.decorator.js';
import { ApiProjectParam } from '../projects/guards/api-project-param.decorator.js';
import { ProjectAccessGuard } from '../projects/guards/project-access.guard.js';
import type { CheckOutcome } from './connection-check.types.js';
import { ConnectionsService, type ConnectionView } from './connections.service.js';
import {
  CheckOutcomeDto,
  ConnectionLinkResponseDto,
  ConnectionResponseDto,
  ConnectionsSummaryDto,
  ConnectionWithCheckDto,
  CreateConnectionDto,
  CreateConnectionLinkDto,
  DisconnectAllResponseDto,
  ProviderResponseDto,
  PublicConnectionLinkDto,
  RotateCredentialDto,
  SubmitConnectionLinkDto,
  SubmitConnectionLinkResponseDto,
  UpdateConnectionDto,
} from './dto/connection.dto.js';
import { PROVIDERS } from './providers/registry.js';

const toDto = (view: ConnectionView) => ConnectionResponseDto.from(view.connection, view.credential);
const withCheck = (result: { view: ConnectionView; check: CheckOutcome | null }): ConnectionWithCheckDto => ({
  connection: toDto(result.view),
  check: result.check ? CheckOutcomeDto.from(result.check) : null,
});

@ApiTags('connections')
@ApiBearerAuth()
@Controller('connection-providers')
export class ConnectionProvidersController {
  @Get()
  @ApiOperation({ summary: 'Catalog of services a project can connect' })
  list(): ProviderResponseDto[] {
    return PROVIDERS.map((provider) => ProviderResponseDto.from(provider));
  }
}

/** Connections and keys: tech and above; the coverage summary is for every member. */
@ApiTags('connections')
@ApiBearerAuth()
@ApiAccountParam()
@ApiProjectParam()
@UseGuards(AccountAccessGuard, ProjectAccessGuard)
@Controller('accounts/:accountId/projects/:projectId/connections')
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get('summary')
  @ApiOperation({ summary: '«The team sees N% of the project» and status counts' })
  summary(): Promise<ConnectionsSummaryDto> {
    return this.connections.summary();
  }

  @Get()
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Connections of the project with their active credential' })
  async list(): Promise<ConnectionResponseDto[]> {
    return (await this.connections.list()).map(toDto);
  }

  @Post()
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Connect a service; the secret is sealed and checked at once' })
  async create(@Body() dto: CreateConnectionDto): Promise<ConnectionWithCheckDto> {
    return withCheck(await this.connections.create(dto));
  }

  @Post('links')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'One-time link for a developer to connect a service' })
  createLink(@Body() dto: CreateConnectionLinkDto): Promise<ConnectionLinkResponseDto> {
    return this.connections.createLink(dto.providerKey);
  }

  @Post('disconnect-all')
  @HttpCode(HttpStatus.OK)
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Disconnect every service of the project (danger zone, H05)' })
  async disconnectAll(): Promise<DisconnectAllResponseDto> {
    return { disconnected: await this.connections.disconnectAll() };
  }

  @Patch(':connectionId')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Rename or change the access level' })
  async update(
    @Param('connectionId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConnectionDto,
  ): Promise<ConnectionResponseDto> {
    return toDto(await this.connections.update(id, dto));
  }

  @Post(':connectionId/check')
  @HttpCode(HttpStatus.OK)
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Check the connection now («Проверить подключение»)' })
  async check(@Param('connectionId', ParseUUIDPipe) id: string): Promise<ConnectionWithCheckDto> {
    return withCheck(await this.connections.check(id));
  }

  @Post(':connectionId/rotate')
  @HttpCode(HttpStatus.OK)
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Replace the credential; the old one works five more minutes' })
  async rotate(
    @Param('connectionId', ParseUUIDPipe) id: string,
    @Body() dto: RotateCredentialDto,
  ): Promise<ConnectionWithCheckDto> {
    return withCheck(await this.connections.rotate(id, dto.fields));
  }

  @Delete(':connectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Disconnect: credentials are destroyed at once' })
  async disconnect(@Param('connectionId', ParseUUIDPipe) id: string): Promise<void> {
    await this.connections.disconnect(id);
  }
}

/** The developer's page (`/connect/<token>`): no sign-in, the token is the credential. */
@ApiTags('connections')
@Public()
@StrictThrottle()
@Controller('connect')
export class ConnectionLinkController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get(':token')
  @ApiOperation({ summary: 'What a developer link connects' })
  async describe(@Param('token') token: string): Promise<PublicConnectionLinkDto> {
    const link = await this.connections.describeLink(token);
    return {
      projectName: link.projectName,
      provider: ProviderResponseDto.from(link.provider),
      expiresAt: link.expiresAt,
    };
  }

  @Post(':token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit the service credentials; the link is used up' })
  async submit(
    @Param('token') token: string,
    @Body() dto: SubmitConnectionLinkDto,
  ): Promise<SubmitConnectionLinkResponseDto> {
    const check = await this.connections.submitLink(token, dto.fields);
    return { check: check ? CheckOutcomeDto.from(check) : null };
  }
}
