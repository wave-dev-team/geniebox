import { z } from 'zod';

const name = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !value.includes('\u0000'));
const instructions = z
  .string()
  .trim()
  .min(1)
  .max(3000)
  .refine((value) => !value.includes('\u0000'));

export const createAgentSchema = z.strictObject({ name, instructions, enabled: z.boolean().default(false) });
export const updateAgentSchema = z
  .strictObject({ name, instructions, enabled: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0);

export type CreateAgent = z.infer<typeof createAgentSchema>;
export type UpdateAgent = z.infer<typeof updateAgentSchema>;
export interface Agent {
  id: string;
  name: string;
  instructions: string;
  enabled: boolean;
}
