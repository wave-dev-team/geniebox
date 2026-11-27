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

export const agentCatalogKeySchema = z.enum(['metrics', 'hypotheses', 'research']);
export const agentSchema = z.object({
  id: z.uuid(),
  name,
  instructions,
  enabled: z.boolean(),
  catalogKey: agentCatalogKeySchema.nullable(),
  revision: z.number().int().positive(),
});
export const agentVersionSchema = z.object({
  name,
  instructions,
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export const createAgentSchema = z.strictObject({ name, instructions, enabled: z.boolean().default(false) });
export const updateAgentSchema = z
  .strictObject({ name, instructions, enabled: z.boolean() })
  .partial()
  .extend({ expectedRevision: z.number().int().positive().optional() })
  .refine(
    ({ name, instructions, enabled }) =>
      name !== undefined || instructions !== undefined || enabled !== undefined,
  );
export const restoreAgentSchema = z.strictObject({
  revision: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
});

export type CreateAgent = z.infer<typeof createAgentSchema>;
export type UpdateAgent = z.infer<typeof updateAgentSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type AgentVersion = z.infer<typeof agentVersionSchema>;
export type AgentCatalogKey = z.infer<typeof agentCatalogKeySchema>;
