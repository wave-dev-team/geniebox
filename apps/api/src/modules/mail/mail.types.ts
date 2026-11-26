import { z } from 'zod';

export const mailTransportToken = Symbol('MAIL_TRANSPORT');
export const mailQueue = 'mail-send';

export const mailMessageSchema = z.object({
  to: z.email(),
  subject: z.string().min(1).max(240),
  text: z.string().min(1).max(12_000),
});
export const mailJobSchema = z.object({
  tenantId: z.uuid(),
  traceId: z.string().min(1).max(128),
  mailId: z.uuid(),
  ciphertext: z.string().min(40).max(100_000),
  expiresAt: z.iso.datetime(),
});

export type MailMessage = z.infer<typeof mailMessageSchema>;
export type MailJob = z.infer<typeof mailJobSchema>;

export interface MailTransport {
  send(message: MailMessage, id?: string): Promise<void>;
}
