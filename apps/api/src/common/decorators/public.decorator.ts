import { type CustomDecorator, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opts an endpoint out of the global auth guard. Every use must be intentional. */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
