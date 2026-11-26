import { BadRequestException, Body, Controller, Get, Header, Patch, Req } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { type Profile, updateProfileSchema } from '@workspace/types';

import { type AuthenticatedRequest } from '../../common/auth/request-actor.js';
import { UsersService } from './users.service.js';

@ApiTags('profile')
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ schema: { type: 'object' } })
  async get(@Req() request: AuthenticatedRequest): Promise<Profile> {
    return this.users.profile(request.user);
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: 120 },
        locale: { type: 'string', enum: ['ru', 'en'] },
        timeZone: { type: 'string', example: 'Europe/Moscow' },
      },
    },
  })
  @ApiOkResponse({ schema: { type: 'object' } })
  async update(@Req() request: AuthenticatedRequest, @Body() body: unknown): Promise<Profile> {
    const update = updateProfileSchema.safeParse(body);
    if (!update.success || !Object.values(update.data).some((value) => value !== undefined)) {
      throw new BadRequestException({
        message: update.success ? [] : update.error.issues.map(({ path, code }) => ({ path, code })),
      });
    }
    return this.users.update(request.user, update.data);
  }
}
