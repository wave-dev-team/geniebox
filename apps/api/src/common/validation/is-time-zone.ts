import { ValidateBy, type ValidationOptions } from 'class-validator';

/** IANA zones known to the runtime (Node ships full ICU), plus UTC. */
const TIME_ZONES = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

/**
 * IANA time zone name. A custom validator instead of @IsIn keeps the 400+ zone list out of the
 * OpenAPI document (the Swagger plugin would turn @IsIn into an enum).
 */
export function IsTimeZone(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isTimeZone',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && TIME_ZONES.has(value),
        defaultMessage: () => '$property must be an IANA time zone',
      },
    },
    options,
  );
}
