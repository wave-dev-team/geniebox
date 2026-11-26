import { ApiParam } from '@nestjs/swagger';

/** Documents `:projectId` for OpenAPI; ProjectAccessGuard reads it, handlers do not. */
export const ApiProjectParam = (): MethodDecorator & ClassDecorator =>
  ApiParam({ name: 'projectId', format: 'uuid', description: 'Project id inside the account' });
