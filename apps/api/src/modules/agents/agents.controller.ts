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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccountAccessGuard } from '../accounts/guards/account-access.guard.js';
import { ApiAccountParam } from '../accounts/guards/api-account-param.decorator.js';
import { RequireAccountRole } from '../accounts/guards/require-account-role.decorator.js';
import { ApiProjectParam } from '../projects/guards/api-project-param.decorator.js';
import { ProjectAccessGuard } from '../projects/guards/project-access.guard.js';
import { AgentCatalogView } from './agent-catalog.view.js';
import { AgentsService } from './agents.service.js';
import {
  AgentCatalogDto,
  AgentDetailsDto,
  AgentResponseDto,
  CatalogQueryDto,
  HireAgentDto,
  PauseAgentDto,
  SetAgentConnectionsDto,
  SetPermissionsDto,
  UpdateAgentDto,
  UpdateAgentRulesDto,
} from './dto/agent.dto.js';

@ApiTags('agents')
@ApiBearerAuth()
@Controller('agent-catalog')
export class AgentCatalogController {
  constructor(private readonly view: AgentCatalogView) {}

  @Get()
  @ApiOperation({ summary: 'Marketplace catalog: templates, tools, asks, limits, skills' })
  get(@Query() query: CatalogQueryDto): Promise<AgentCatalogDto> {
    return this.view.build(query.accountId);
  }
}

/**
 * Team of a project. Hiring, pause, firing and trust: admin; instructions, limits, asks,
 * permissions and connections: tech; reading: every member.
 */
@ApiTags('agents')
@ApiBearerAuth()
@ApiAccountParam()
@ApiProjectParam()
@UseGuards(AccountAccessGuard, ProjectAccessGuard)
@Controller('accounts/:accountId/projects/:projectId/agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @ApiOperation({ summary: 'Agents of the project, the manager included (kind = manager)' })
  async list(): Promise<AgentResponseDto[]> {
    return (await this.agents.list()).map(({ agent, connections }) =>
      AgentResponseDto.from(agent, connections),
    );
  }

  @Post()
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Hire a catalog agent or create a custom one' })
  async hire(@Body() dto: HireAgentDto): Promise<AgentDetailsDto> {
    return AgentDetailsDto.fromDetails(await this.agents.hire(dto));
  }

  @Get(':agentId')
  @ApiOperation({ summary: 'Agent with connections, effective permissions and notes' })
  async get(@Param('agentId', ParseUUIDPipe) id: string): Promise<AgentDetailsDto> {
    return AgentDetailsDto.fromDetails(await this.agents.get(id));
  }

  @Patch(':agentId')
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Rename, role line, icon, trust level' })
  async update(
    @Param('agentId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgentDto,
  ): Promise<AgentDetailsDto> {
    return AgentDetailsDto.fromDetails(await this.agents.update(id, dto));
  }

  @Patch(':agentId/rules')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Instructions, limits and «always ask»' })
  async updateRules(
    @Param('agentId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgentRulesDto,
  ): Promise<AgentDetailsDto> {
    return AgentDetailsDto.fromDetails(await this.agents.updateRules(id, dto));
  }

  @Put(':agentId/permissions')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Set modes per tool; system-denied tools stay closed' })
  async setPermissions(
    @Param('agentId', ParseUUIDPipe) id: string,
    @Body() dto: SetPermissionsDto,
  ): Promise<AgentDetailsDto> {
    return AgentDetailsDto.fromDetails(await this.agents.setPermissions(id, dto.items));
  }

  @Put(':agentId/connections')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Connections the agent uses and its access level' })
  async setConnections(
    @Param('agentId', ParseUUIDPipe) id: string,
    @Body() dto: SetAgentConnectionsDto,
  ): Promise<AgentDetailsDto> {
    return AgentDetailsDto.fromDetails(await this.agents.setConnections(id, dto.connections));
  }

  @Post(':agentId/pause')
  @HttpCode(HttpStatus.OK)
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Pause the agent, optionally until a date' })
  async pause(
    @Param('agentId', ParseUUIDPipe) id: string,
    @Body() dto: PauseAgentDto,
  ): Promise<AgentDetailsDto> {
    return AgentDetailsDto.fromDetails(await this.agents.pause(id, dto.until));
  }

  @Post(':agentId/resume')
  @HttpCode(HttpStatus.OK)
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Resume the agent' })
  async resume(@Param('agentId', ParseUUIDPipe) id: string): Promise<AgentDetailsDto> {
    return AgentDetailsDto.fromDetails(await this.agents.resume(id));
  }

  @Delete(':agentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Remove the agent from the team; history stays' })
  async fire(@Param('agentId', ParseUUIDPipe) id: string): Promise<void> {
    await this.agents.fire(id);
  }

  @Delete(':agentId/notes/:noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Delete a wrong conclusion of the agent' })
  async deleteNote(
    @Param('agentId', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ): Promise<void> {
    await this.agents.deleteNote(id, noteId);
  }
}
