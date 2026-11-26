import { Global, Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { StreamController } from './stream.controller.js';
import { StreamHub } from './stream.hub.js';
import { StreamPublisher } from './stream.publisher.js';

/** Publisher for API and worker. */
@Global()
@Module({ providers: [StreamPublisher], exports: [StreamPublisher] })
export class StreamPublisherModule {}

/** SSE endpoint of the public API. */
@Module({
  imports: [AccountsModule, ProjectsModule],
  controllers: [StreamController],
  providers: [StreamHub],
})
export class StreamModule {}
