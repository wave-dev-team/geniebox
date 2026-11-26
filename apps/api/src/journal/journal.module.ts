import { Module } from '@nestjs/common';

import { JournalService } from './journal.service.js';

@Module({ providers: [JournalService], exports: [JournalService] })
export class JournalModule {}
