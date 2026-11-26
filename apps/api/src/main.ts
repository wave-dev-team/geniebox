import { ConfigService } from '@nestjs/config';

import { createApp } from './create-app.js';

const app = await createApp();
const config = app.get(ConfigService);
await app.listen(config.getOrThrow<number>('API_PORT'), config.getOrThrow<string>('API_HOST'));
