import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';

import { reportDecisionInputSchema } from '@workspace/types';

import type { AuthenticatedRequest } from '../../common/auth/request-actor.js';
import { ReportDecisionsService } from './report-decisions.service.js';

@Controller('reports/:reportId/decision')
export class ActionsController {
  constructor(private readonly decisions: ReportDecisionsService) {}

  @Post()
  @HttpCode(200)
  decide(
    @Req() request: AuthenticatedRequest,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() body: unknown,
  ) {
    const decision = reportDecisionInputSchema.safeParse(body);
    if (!decision.success) throw new BadRequestException();
    return this.decisions.decide(request.user, reportId, decision.data);
  }
}
