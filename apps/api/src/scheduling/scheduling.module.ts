import { Module } from '@nestjs/common';

import { RoutinesDataModule } from '../modules/routines/routines.module.js';
import { SchedulingService } from './scheduling.service.js';

@Module({ imports: [RoutinesDataModule], providers: [SchedulingService] })
export class SchedulingModule {}
