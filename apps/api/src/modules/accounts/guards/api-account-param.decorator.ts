import { ApiParam } from '@nestjs/swagger';

/**
 * Documents `:accountId` for OpenAPI. The handlers never read it themselves (AccountAccessGuard
 * resolves it into CLS), so Swagger cannot infer the path parameter on its own.
 */
export const ApiAccountParam = (): MethodDecorator & ClassDecorator =>
  ApiParam({ name: 'accountId', format: 'uuid', description: 'Account (tenant) id' });
