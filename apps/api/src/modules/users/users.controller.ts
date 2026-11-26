import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ProfileResponseDto, UpdateProfileDto } from './dto/profile.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Current user profile' })
  async get(): Promise<ProfileResponseDto> {
    return ProfileResponseDto.from(await this.users.getProfile());
  }

  @Patch()
  @ApiOperation({ summary: 'Update the current user profile' })
  async update(@Body() dto: UpdateProfileDto): Promise<ProfileResponseDto> {
    return ProfileResponseDto.from(await this.users.updateProfile(dto));
  }
}
