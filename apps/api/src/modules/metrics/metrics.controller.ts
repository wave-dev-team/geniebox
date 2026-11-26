import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';

import { AccountAccessGuard } from '../accounts/guards/account-access.guard.js';
import { ApiAccountParam } from '../accounts/guards/api-account-param.decorator.js';
import { RequireAccountRole } from '../accounts/guards/require-account-role.decorator.js';
import { ApiProjectParam } from '../projects/guards/api-project-param.decorator.js';
import { ProjectAccessGuard } from '../projects/guards/project-access.guard.js';
import { ActivityService } from './activity.service.js';
import {
  CreateMetricDto,
  MetricResponseDto,
  PointDto,
  ResultsQueryDto,
  SeriesQueryDto,
  UpdateMetricDto,
} from './dto/metric.dto.js';
import {
  ActivityPageDto,
  ActivityQueryDto,
  AgentStatsDto,
  InsightResponseDto,
  ResultsResponseDto,
  SummaryQueryDto,
  SummaryResponseDto,
} from './dto/summary.dto.js';
import { MetricsService } from './metrics.service.js';
import { ResultsService } from './results.service.js';

/** Official metrics: everyone reads, only admins change them. */
@ApiTags('metrics')
@ApiBearerAuth()
@ApiAccountParam()
@ApiProjectParam()
@UseGuards(AccountAccessGuard, ProjectAccessGuard)
@Controller('accounts/:accountId/projects/:projectId/metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Official metrics of the project' })
  list(): Promise<MetricResponseDto[]> {
    return this.metrics.list();
  }

  @Post()
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Add an official metric' })
  create(@Body() dto: CreateMetricDto): Promise<MetricResponseDto> {
    return this.metrics.create(dto);
  }

  @Patch(':metricId')
  @RequireAccountRole('admin')
  @ApiOperation({ summary: 'Change a metric; a new source collects again from scratch' })
  update(
    @Param('metricId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMetricDto,
  ): Promise<MetricResponseDto> {
    return this.metrics.update(id, dto);
  }

  @Delete(':metricId')
  @RequireAccountRole('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a metric with its points' })
  delete(@Param('metricId', ParseUUIDPipe) id: string): Promise<void> {
    return this.metrics.delete(id);
  }

  @Post(':metricId/collect')
  @RequireAccountRole('admin')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Collect the metric now (in the background)' })
  collect(@Param('metricId', ParseUUIDPipe) id: string): Promise<MetricResponseDto> {
    return this.metrics.collect(id);
  }

  @Get(':metricId/series')
  @ApiOperation({ summary: 'Daily points for 7, 30 or 90 days' })
  series(@Param('metricId', ParseUUIDPipe) id: string, @Query() query: SeriesQueryDto): Promise<PointDto[]> {
    return this.metrics.series(id, query.days ?? 30);
  }
}

/** Summary, results, insights, agent numbers. */
@ApiTags('results')
@ApiBearerAuth()
@ApiAccountParam()
@ApiProjectParam()
@UseGuards(AccountAccessGuard, ProjectAccessGuard)
@Controller('accounts/:accountId/projects/:projectId')
export class ResultsController {
  constructor(
    private readonly results: ResultsService,
    private readonly activity: ActivityService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'What happens with the business and the team' })
  summary(@Query() query: SummaryQueryDto): Promise<SummaryResponseDto> {
    return this.results.summary(query.days ?? 30);
  }

  @Get('results')
  @ApiOperation({ summary: 'What the team brought, confirmed by checks' })
  resultsFor(@Query() query: ResultsQueryDto): Promise<ResultsResponseDto> {
    return this.results.resultsFor(query.days ?? 30, query.metric);
  }

  @Get('insights/:insightId')
  @ApiOperation({ summary: 'How an insight was calculated' })
  insight(@Param('insightId', ParseUUIDPipe) id: string): Promise<InsightResponseDto> {
    return this.results.insight(id);
  }

  @Get('agents/:agentId/stats')
  @ApiOperation({ summary: 'Agent numbers: brought, cost, accepted, actions, streak' })
  agentStats(@Param('agentId', ParseUUIDPipe) agentId: string): Promise<AgentStatsDto> {
    return this.results.agentStats(agentId);
  }

  @Get('journal')
  @RequireAccountRole('tech')
  @ApiOperation({ summary: 'Agent calls to services' })
  journal(@Query() query: ActivityQueryDto): Promise<ActivityPageDto> {
    return this.activity.page(query);
  }

  @Get('journal.csv')
  @RequireAccountRole('tech')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="geniebox-journal.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'The journal as CSV, up to 5 000 rows' })
  journalCsv(@Query() query: ActivityQueryDto): Promise<string> {
    return this.activity.csv(query);
  }
}
