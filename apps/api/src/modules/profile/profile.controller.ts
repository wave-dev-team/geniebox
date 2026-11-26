import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Patch,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { type Profile, updateProfileSchema } from '@workspace/types';

import { type AuthenticatedRequest, homeActor } from '../../common/auth/request-actor.js';
import { ProfileRepository, toProfile } from './profile.repository.js';

@ApiTags('profile')
@Controller('me')
export class ProfileController {
  constructor(private readonly profiles: ProfileRepository) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ schema: { type: 'object' } })
  async get(@Req() request: AuthenticatedRequest): Promise<Profile> {
    const profile = await this.profiles.find(homeActor(request.user));
    if (!profile) throw new UnauthorizedException();
    return { ...toProfile(profile), tenantId: request.user.tenantId };
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
    const profile = await this.profiles.update(homeActor(request.user), update.data);
    return { ...toProfile(profile), tenantId: request.user.tenantId };
  }
}
