import { z } from 'zod';

export const locales = ['ru', 'en'] as const;
export const localeSchema = z.enum(locales);
export const emailSchema = z.email().max(254);
export const nameSchema = z.string().trim().min(1).max(120);
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
export const codeSchema = z.string().regex(/^\d{6}$/);

export const profileSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  email: emailSchema,
  name: z.string(),
  locale: localeSchema,
  timeZone: z.string().nullable(),
  emailVerified: z.boolean(),
  passwordChangedAt: z.iso.datetime(),
  hasPassword: z.boolean(),
  connections: z.array(z.enum(['google', 'apple'])),
});

export const updateProfileSchema = z.strictObject({
  name: nameSchema.optional(),
  locale: localeSchema.optional(),
  timeZone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    })
    .nullable()
    .optional(),
});

export const authResultSchema = z.object({ created: z.boolean(), emailVerified: z.boolean() });
export const sessionSchema = z.object({
  id: z.uuid(),
  current: z.boolean(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime(),
});
export const sessionsSchema = z.array(sessionSchema);

export type Profile = z.infer<typeof profileSchema>;
export type ProfileUpdate = z.infer<typeof updateProfileSchema>;
export type AuthResult = z.infer<typeof authResultSchema>;
export type Session = z.infer<typeof sessionSchema>;
