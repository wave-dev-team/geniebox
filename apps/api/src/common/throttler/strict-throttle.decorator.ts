import { type CustomDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

export const STRICT_THROTTLER = 'strict';
const STRICT_THROTTLE_KEY = 'strictThrottle';

/** Applies the additional per-IP "strict" limit (AUTH_THROTTLE_LIMIT/min): credential endpoints. */
export const StrictThrottle = (): CustomDecorator => SetMetadata(STRICT_THROTTLE_KEY, true);

export function isStrictThrottled(context: ExecutionContext): boolean {
  const handler: unknown = Reflect.getMetadata(STRICT_THROTTLE_KEY, context.getHandler());
  const controller: unknown = Reflect.getMetadata(STRICT_THROTTLE_KEY, context.getClass());
  return handler === true || controller === true;
}
