import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

import { AccountAccessGuard } from '../accounts/guards/account-access.guard.js';
import { ApiAccountParam } from '../accounts/guards/api-account-param.decorator.js';
import { ApiProjectParam } from '../projects/guards/api-project-param.decorator.js';
import { ProjectAccessGuard } from '../projects/guards/project-access.guard.js';
import { ProjectContext } from '../projects/project-context.js';
import { MessageActionsService } from './message-actions.service.js';

export class PressResultDto {
  @ApiProperty({ enum: ['done', 'failed'] })
  status: 'done' | 'failed';

  @ApiProperty({ description: 'What happened, for a toast' })
  text: string;

  @ApiProperty({ nullable: true, type: String, description: 'Open this (checkout, form)' })
  url: string | null;
}

/** A button under a message, pressed in the panel. */
@ApiTags('conversations')
@ApiBearerAuth()
@ApiAccountParam()
@ApiProjectParam()
@UseGuards(AccountAccessGuard, ProjectAccessGuard)
@Controller('accounts/:accountId/projects/:projectId/message-actions')
export class MessageActionsController {
  constructor(
    private readonly actions: MessageActionsService,
    private readonly projectContext: ProjectContext,
  ) {}

  @Post(':actionId/press')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Press a button of a message: runs its action with your rights' })
  async press(@Param('actionId', ParseUUIDPipe) actionId: string): Promise<PressResultDto> {
    const actor = this.projectContext.actor();
    const result = await this.actions.press(actionId, actor.userId, actor.projectId);
    return { status: result.status, text: result.text, url: result.url ?? null };
  }
}
