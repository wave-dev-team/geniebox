import { OnEvent } from '@nestjs/event-emitter';

/**
 * Subscribes to an outbox-delivered event. Errors propagate so BullMQ retries the delivery;
 * handlers must therefore be idempotent by `envelope.eventId`.
 */
export const OnOutboxEvent = (type: string): MethodDecorator =>
  OnEvent(type, { async: true, promisify: true, suppressErrors: false });
