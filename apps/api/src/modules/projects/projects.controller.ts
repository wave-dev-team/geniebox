import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccountAccessGuard } from '../accounts/guards/account-access.guard.js';
import { ApiAccountParam } from '../accounts/guards/api-account-param.decorator.js';
import { RequireAccountRole } from '../accounts/guards/require-account-role.decorator.js';
import {
  CreateProjectDto,
  DeleteProjectDto,
  MyProjectResponseDto,
  PauseProjectDto,
  ProjectResponseDto,
  UpdateProjectDto,
  UpdateProjectRulesDto,
} from './dto/project.dto.js';
import { ApiProjectParam } from './guards/api-project-param.decorator.js';
import { ProjectAccessGuard } from './guards/project-access.guard.js';
import { ProjectsService } from './projects.service.js';

@ApiTags('projects')
@ApiBearerAuth()
@ApiAccountParam()
@UseGuards(AccountAccessGuard)
@Controller('accounts/:accountId/projects')
export class AccountProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Create a project (admin); onboarding starts at step 1' })
  async create(@Body() dto: CreateProjectDto): Promise<ProjectResponseDto> {
    return ProjectResponseDto.from(await this.projects.create(dto));
  }

  @Get()
  @ApiOperation({ summary: 'Projects of the account' })
  async list(): Promise<ProjectResponseDto[]> {
    return (await this.projects.listInAccount()).map((row) => ProjectResponseDto.from(row));
  }
}

/** One project. Guards run in order: account membership first, then the project inside it. */
@ApiTags('projects')
@ApiBearerAuth()
@ApiAccountParam()
@ApiProjectParam()
@UseGuards(AccountAccessGuard, ProjectAccessGuard)
@Controller('accounts/:accountId/projects/:projectId')
export class ProjectController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'Project with all settings' })
  async get(): Promise<ProjectResponseDto> {
    return ProjectResponseDto.from(await this.projects.get());
  }

  @Patch()
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Update general and security settings or onboarding step (admin)' })
  async update(@Body() dto: UpdateProjectDto): Promise<ProjectResponseDto> {
    return ProjectResponseDto.from(await this.projects.update(dto));
  }

  @Patch('rules')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Update rules for agents: trust, always-ask, limits (tech and above)' })
  async updateRules(@Body() dto: UpdateProjectRulesDto): Promise<ProjectResponseDto> {
    return ProjectResponseDto.from(await this.projects.updateRules(dto));
  }

  @Post('onboarding/complete')
  @HttpCode(HttpStatus.OK)
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Finish onboarding; idempotent' })
  async completeOnboarding(): Promise<ProjectResponseDto> {
    return ProjectResponseDto.from(await this.projects.completeOnboarding());
  }

  @Post('pause')
  @HttpCode(HttpStatus.OK)
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Pause all agents of the project (kill switch)' })
  async pause(@Body() dto: PauseProjectDto): Promise<ProjectResponseDto> {
    return ProjectResponseDto.from(await this.projects.pause(dto.until));
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Resume the agents of the project' })
  async resume(): Promise<ProjectResponseDto> {
    return ProjectResponseDto.from(await this.projects.resume());
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAccountRole('owner')
  @ApiOperation({ summary: 'Delete the project (owner); data is purged after the grace period' })
  async delete(@Body() dto: DeleteProjectDto): Promise<void> {
    await this.projects.delete(dto.confirmName);
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me/projects')
export class MyProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'Projects from every account of the current user (project switcher)' })
  async list(): Promise<MyProjectResponseDto[]> {
    return (await this.projects.listMine()).map((row) => MyProjectResponseDto.from(row));
  }
}
