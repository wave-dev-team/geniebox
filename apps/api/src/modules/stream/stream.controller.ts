import { Observable } from 'rxjs';

import { Controller, type MessageEvent, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';

import { AccountAccessGuard } from '../accounts/guards/account-access.guard.js';
import { ApiAccountParam } from '../accounts/guards/api-account-param.decorator.js';
import { ApiProjectParam } from '../projects/guards/api-project-param.decorator.js';
import { ProjectAccessGuard } from '../projects/guards/project-access.guard.js';
import { ProjectContext } from '../projects/project-context.js';
import { StreamHub } from './stream.hub.js';

const HEARTBEAT_MS = 25_000;

@ApiTags('stream')
@ApiBearerAuth()
@ApiAccountParam()
@ApiProjectParam()
@UseGuards(AccountAccessGuard, ProjectAccessGuard)
@Controller('accounts/:accountId/projects/:projectId/stream')
export class StreamController {
  constructor(
    private readonly hub: StreamHub,
    private readonly projectContext: ProjectContext,
  ) {}

  @Sse()
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary: 'Live events of the project (SSE): messages, tasks, decisions, routines, agents',
  })
  stream(): Observable<MessageEvent> {
    const { projectId } = this.projectContext.actor();
    return new Observable<MessageEvent>((subscriber) => {
      const unsubscribe = this.hub.subscribe(projectId, (event) =>
        subscriber.next({ type: event.type, data: event }),
      );
      subscriber.next({ type: 'ready', data: {} });
      const heartbeat = setInterval(() => subscriber.next({ type: 'ping', data: {} }), HEARTBEAT_MS);
      return () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    });
  }
}
