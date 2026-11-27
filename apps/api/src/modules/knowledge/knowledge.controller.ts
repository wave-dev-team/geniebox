import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccountAccessGuard } from '../accounts/guards/account-access.guard.js';
import { ApiAccountParam } from '../accounts/guards/api-account-param.decorator.js';
import { RequireAccountRole } from '../accounts/guards/require-account-role.decorator.js';
import { ApiProjectParam } from '../projects/guards/api-project-param.decorator.js';
import { ProjectAccessGuard } from '../projects/guards/project-access.guard.js';
import {
  CreateNodeDto,
  CreateSourceDto,
  KnowledgeNodeDto,
  KnowledgeSourceDto,
  KnowledgeStatsDto,
  ProposalDto,
  ProposalsQueryDto,
  RevisionDto,
  SearchQueryDto,
  SourcesQueryDto,
  TreeQueryDto,
  UpdateNodeDto,
} from './dto/knowledge.dto.js';
import { KnowledgeService } from './knowledge.service.js';

/**
 * The project's knowledge base. Everybody reads, `tech` drafts and uploads, `admin` publishes
 * and resolves agent proposals. Agents never call this controller.
 */
@ApiTags('knowledge')
@ApiBearerAuth()
@ApiAccountParam()
@ApiProjectParam()
@UseGuards(AccountAccessGuard, ProjectAccessGuard)
@Controller('accounts/:accountId/projects/:projectId/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get('nodes')
  @ApiOperation({ summary: 'Tree and children of a folder; viewers see published pages only' })
  async tree(@Query() query: TreeQueryDto): Promise<KnowledgeNodeDto[]> {
    const nodes = await this.knowledge.tree({ parentId: query.parentId, status: query.status });
    return nodes.map(KnowledgeNodeDto.from);
  }

  @Get('nodes/:nodeId')
  @ApiOperation({ summary: 'One page with its body' })
  async node(@Param('nodeId', ParseUUIDPipe) nodeId: string): Promise<KnowledgeNodeDto> {
    return KnowledgeNodeDto.from(await this.knowledge.node(nodeId));
  }

  @Post('nodes')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Create a folder or a draft page' })
  async create(@Body() dto: CreateNodeDto): Promise<KnowledgeNodeDto> {
    return KnowledgeNodeDto.from(await this.knowledge.create(dto));
  }

  @Patch('nodes/:nodeId')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Rename, rewrite, move; a tech edit of a published page becomes a draft' })
  async update(
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Body() dto: UpdateNodeDto,
  ): Promise<KnowledgeNodeDto> {
    return KnowledgeNodeDto.from(await this.knowledge.update(nodeId, dto));
  }

  @Post('nodes/:nodeId/publish')
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Publish a page: agents see it after indexing' })
  async publish(@Param('nodeId', ParseUUIDPipe) nodeId: string): Promise<KnowledgeNodeDto> {
    return KnowledgeNodeDto.from(await this.knowledge.publish(nodeId));
  }

  @Post('nodes/:nodeId/archive')
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Archive: leaves the tree and the agent search, history stays' })
  async archive(@Param('nodeId', ParseUUIDPipe) nodeId: string): Promise<KnowledgeNodeDto> {
    return KnowledgeNodeDto.from(await this.knowledge.archive(nodeId));
  }

  @Post('nodes/:nodeId/restore')
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Bring an archived page back as a draft' })
  async restore(@Param('nodeId', ParseUUIDPipe) nodeId: string): Promise<KnowledgeNodeDto> {
    return KnowledgeNodeDto.from(await this.knowledge.restore(nodeId));
  }

  @Get('nodes/:nodeId/revisions')
  @ApiOperation({ summary: 'History of a page, newest first' })
  async revisions(@Param('nodeId', ParseUUIDPipe) nodeId: string): Promise<RevisionDto[]> {
    return (await this.knowledge.revisions(nodeId)).map(RevisionDto.from);
  }

  @Post('nodes/:nodeId/revisions/:revision/restore')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Restore an old version as a new draft' })
  async restoreRevision(
    @Param('nodeId', ParseUUIDPipe) nodeId: string,
    @Param('revision', ParseIntPipe) revision: number,
  ): Promise<KnowledgeNodeDto> {
    return KnowledgeNodeDto.from(await this.knowledge.restoreRevision(nodeId, revision));
  }

  @Post('sources')
  @RequireAccountRole('tech')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Upload a file or paste text; extraction runs in the background' })
  async createSource(@Body() dto: CreateSourceDto): Promise<KnowledgeSourceDto> {
    return KnowledgeSourceDto.from(await this.knowledge.createSource(dto));
  }

  @Get('sources')
  @ApiOperation({ summary: 'Sources of the project and their processing status' })
  async sources(@Query() query: SourcesQueryDto): Promise<KnowledgeSourceDto[]> {
    return (await this.knowledge.sources(query)).map(KnowledgeSourceDto.from);
  }

  @Post('sources/:sourceId/retry')
  @RequireAccountRole('tech')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Process a failed source again' })
  async retrySource(@Param('sourceId', ParseUUIDPipe) sourceId: string): Promise<KnowledgeSourceDto> {
    return KnowledgeSourceDto.from(await this.knowledge.retrySource(sourceId));
  }

  @Get('search')
  @ApiOperation({ summary: 'Hybrid search over published pages, one hit per page' })
  async search(@Query() query: SearchQueryDto) {
    return this.knowledge.search(query);
  }

  @Get('proposals')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'What agents proposed to add or change' })
  async proposals(@Query() query: ProposalsQueryDto): Promise<ProposalDto[]> {
    return (await this.knowledge.proposals(query)).map(ProposalDto.from);
  }

  @Post('proposals/:proposalId/accept')
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Accept: creates or edits a draft, never publishes it' })
  async accept(@Param('proposalId', ParseUUIDPipe) proposalId: string): Promise<ProposalDto> {
    return ProposalDto.from(await this.knowledge.acceptProposal(proposalId));
  }

  @Post('proposals/:proposalId/reject')
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Reject a proposal' })
  async reject(@Param('proposalId', ParseUUIDPipe) proposalId: string): Promise<ProposalDto> {
    return ProposalDto.from(await this.knowledge.rejectProposal(proposalId));
  }

  @Get('stats')
  @ApiOperation({ summary: 'Drafts, published pages, failed sources, open proposals' })
  stats(): Promise<KnowledgeStatsDto> {
    return this.knowledge.stats();
  }
}
