import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator.js';

export class LivenessResponseDto {
  status: 'ok';
}

/** Public liveness probe: says only that the process is up, nothing about dependencies. */
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  live(): LivenessResponseDto {
    return { status: 'ok' };
  }
}
