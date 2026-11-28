import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator.js';
import type { Env } from '../../config/env.schema.js';
import {
  type CreateDemoIssueInput,
  DemoSandboxService,
  type UpdateDemoIssueInput,
} from './sandbox.service.js';

@ApiTags('sandbox')
@Controller({ path: 'sandbox/demo', version: VERSION_NEUTRAL })
export class DemoSandboxController {
  private readonly enabled: boolean;

  constructor(
    private readonly sandbox: DemoSandboxService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('DEMO_SANDBOX_ENABLED', { infer: true });
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new NotFoundException();
  }

  @Public()
  @Get('stat/v1/data')
  metrika(@Query('metrics') metrics?: string, @Query('dimensions') dimensions?: string) {
    this.assertEnabled();
    return this.sandbox.metrikaData({ metrics, dimensions });
  }

  @Public()
  @Get('issues')
  listIssues() {
    this.assertEnabled();
    return { items: this.sandbox.listIssues() };
  }

  @Public()
  @Post('issues')
  createIssue(@Body() body: CreateDemoIssueInput) {
    this.assertEnabled();
    return this.sandbox.createIssue(body);
  }

  @Public()
  @Patch('issues/:id')
  updateIssue(@Param('id') id: string, @Body() body: UpdateDemoIssueInput) {
    this.assertEnabled();
    const updated = this.sandbox.updateIssue(id, body);
    if (!updated) throw new NotFoundException();
    return updated;
  }
}
