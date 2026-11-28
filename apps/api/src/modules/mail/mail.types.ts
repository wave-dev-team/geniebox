import { z } from 'zod';

import { SUPPORTED_LOCALES } from '../../common/i18n/locales.js';

/** Template id = key in i18n/<lang>/mail.json; params are interpolated into subject and text. */
export const MAIL_TEMPLATES = [
  'login_code',
  'verify_email_code',
  'reset_password_code',
  'account_invitation',
  'support_request',
  'support_turnkey',
  'connection_ready',
  'account_blocked',
  'account_unblocked',
  'agent_alert',
] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];

export const mailJobSchema = z.object({
  to: z.email(),
  template: z.enum(MAIL_TEMPLATES),
  locale: z.enum(SUPPORTED_LOCALES),
  params: z.record(z.string(), z.string()),
  traceId: z.string().min(1),
});
export type MailJob = z.infer<typeof mailJobSchema>;

export interface RenderedMail {
  to: string;
  subject: string;
  text: string;
}

/** Delivery backend; selected by MAIL_TRANSPORT. */
export interface MailTransport {
  send(mail: RenderedMail): Promise<void>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
