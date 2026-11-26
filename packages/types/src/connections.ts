import { z } from 'zod';

export const metricaConnectionInputSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('demo') }),
  z.strictObject({
    mode: z.literal('live'),
    counterId: z
      .string()
      .trim()
      .regex(/^[1-9]\d{0,14}$/),
    token: z
      .string()
      .trim()
      .min(12)
      .max(512)
      .regex(/^[\w.-]+$/),
  }),
]);

export const metricaConnectionSchema = z.object({
  mode: z.enum(['demo', 'live']),
  counterId: z.string().nullable(),
  checkedAt: z.iso.datetime(),
});

export const connectionsSchema = z.object({
  liveAvailable: z.boolean(),
  metrica: metricaConnectionSchema.nullable(),
});

export type MetricaConnectionInput = z.infer<typeof metricaConnectionInputSchema>;
