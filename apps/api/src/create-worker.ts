import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { WorkerModule } from './worker.module.js';

export async function createWorker() {
  const worker = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  worker.useLogger(worker.get(Logger));
  worker.flushLogs();
  worker.enableShutdownHooks();
  return worker;
}
