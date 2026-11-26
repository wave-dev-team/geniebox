import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { ProfileController } from './profile.controller.js';
import { ProfileRepository } from './profile.repository.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ProfileController],
  providers: [ProfileRepository],
  exports: [ProfileRepository],
})
export class ProfileModule {}
