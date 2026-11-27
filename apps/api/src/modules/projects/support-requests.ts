import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

import { Body, Controller, Injectable, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { DEFAULT_LOCALE } from '../../common/i18n/locales.js';
import type { Env } from '../../config/env.schema.js';
import { UserDb } from '../../database/scoped-db.js';
import { OnOutboxEvent } from '../../outbox/on-outbox-event.decorator.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import type { OutboxEnvelope } from '../../outbox/outbox.types.js';
import { MailService, type SendMailInput } from '../mail/mail.service.js';
import { PROJECT_ERRORS, ProjectException } from './projects.errors.js';

const SUPPORT_REQUESTED = 'support.requested';

class SupportRequestDto {
  @IsIn(['support', 'turnkey'])
  kind: 'support' | 'turnkey';

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  topic?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  services?: string[];

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 5000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  preferredTime?: string;

  @IsOptional()
  @IsBoolean()
  attachJournal?: boolean;
}

@Injectable()
export class SupportRequestsService {
  constructor(
    private readonly userDb: UserDb,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  create(input: SupportRequestDto) {
    return this.userDb.transaction(async ({ db, traceId, userId }) => {
      const project = input.projectId
        ? await db
            .selectFrom('projects')
            .innerJoin('account_members', 'account_members.account_id', 'projects.account_id')
            .select('projects.name')
            .where('projects.id', '=', input.projectId)
            .where('projects.deleted_at', 'is', null)
            .where('account_members.user_id', '=', userId)
            .executeTakeFirst()
        : undefined;
      if (input.projectId && !project) throw new ProjectException(PROJECT_ERRORS.PROJECT_NOT_FOUND);
      const user = await db
        .selectFrom('users')
        .select('email')
        .where('id', '=', userId)
        .executeTakeFirstOrThrow();
      const request = await db
        .insertInto('support_requests')
        .values({
          user_id: userId,
          project_id: input.projectId ?? null,
          kind: input.kind,
          topic: input.topic ?? null,
          services: input.services ?? [],
          message: input.message,
          contact: input.contact ?? null,
          preferred_time: input.preferredTime ?? null,
          attach_journal: input.attachJournal ?? false,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.outbox.add<SendMailInput>(
        { db, traceId, accountId: null },
        {
          type: SUPPORT_REQUESTED,
          payload: {
            to: this.config.get('SUPPORT_EMAIL', { infer: true }),
            template: input.kind === 'support' ? 'support_request' : 'support_turnkey',
            locale: DEFAULT_LOCALE,
            params: {
              requestId: request.id,
              from: user.email,
              project: project?.name ?? '—',
              topic: input.topic ?? '—',
              message: input.message,
              attachJournal: input.attachJournal ? 'да' : 'нет',
              services: input.services?.join(', ') ?? '—',
              contact: input.contact ?? '—',
              preferredTime: input.preferredTime ?? '—',
            },
          },
        },
      );
      return request;
    });
  }
}

@ApiTags('support')
@ApiBearerAuth()
@Controller('support/requests')
export class SupportRequestsController {
  constructor(private readonly requests: SupportRequestsService) {}

  @Post()
  create(@Body() input: SupportRequestDto) {
    return this.requests.create(input);
  }
}

@Injectable()
export class SupportRequestsMailer {
  constructor(private readonly mail: MailService) {}

  @OnOutboxEvent(SUPPORT_REQUESTED)
  send(event: OutboxEnvelope<SendMailInput>) {
    return this.mail.send(event.payload, event.eventId);
  }
}
