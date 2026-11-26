import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

import { type HealthResponse, healthStatuses } from '@workspace/types';

import { Public } from '../../common/auth/public.js';

class HealthResponseDto implements HealthResponse {
  @ApiProperty({ description: 'Liveness status of the API process.', enum: [...healthStatuses] })
  status!: HealthResponse['status'];
}

@Public()
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Check whether the API process is alive' })
  @ApiOkResponse({ type: HealthResponseDto })
  async check(): Promise<HealthResponseDto> {
    const { status } = await this.health.check([]);
    return { status };
  }
}
