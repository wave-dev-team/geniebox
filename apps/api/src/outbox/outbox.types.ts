import { z } from 'zod';

/** What listeners receive. `eventId` is the dedupe key: delivery is at-least-once. */
export const outboxEnvelopeSchema = z.object({
  eventId: z.uuid(),
  type: z.string().min(1),
  // null for platform-level events (e.g. user.registered).
  accountId: z.uuid().nullable(),
  traceId: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  payload: z.unknown(),
});

export type OutboxEnvelope<TPayload = unknown> = Omit<z.infer<typeof outboxEnvelopeSchema>, 'payload'> & {
  payload: TPayload;
};

export interface OutboxEventInput<TPayload> {
  /** `domain.action` in past tense, e.g. `account.created`. */
  type: string;
  payload: TPayload;
}
