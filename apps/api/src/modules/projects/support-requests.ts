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
import { SystemDb } from '../../database/system-db.js';
import { OnOutboxEvent } from '../../outbox/on-outbox-event.decorator.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import type { OutboxEnvelope } from '../../outbox/outbox.types.js';
import { MailService } from '../mail/mail.service.js';
import { PROJECT_ERRORS, ProjectException } from './projects.errors.js';

const SUPPORT_REQUESTED = 'support.requested';
type SupportRequested = { requestId: string };

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
      await this.outbox.add<SupportRequested>(
        { db, traceId, accountId: null },
        {
          type: SUPPORT_REQUESTED,
          payload: { requestId: request.id },
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
  constructor(
    // Account-less support requests are delivered to the shared support inbox.
    private readonly systemDb: SystemDb,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @OnOutboxEvent(SUPPORT_REQUESTED)
  async send(event: OutboxEnvelope<SupportRequested>): Promise<void> {
    const request = await this.systemDb.db
      .selectFrom('support_requests')
      .innerJoin('users', 'users.id', 'support_requests.user_id')
      .leftJoin('projects', 'projects.id', 'support_requests.project_id')
      .selectAll('support_requests')
      .select(['users.email', 'projects.name as project_name'])
      .where('support_requests.id', '=', event.payload.requestId)
      .executeTakeFirst();
    if (!request) return;
    await this.mail.send(
      {
        to: this.config.get('SUPPORT_EMAIL', { infer: true }),
        template: request.kind === 'support' ? 'support_request' : 'support_turnkey',
        locale: DEFAULT_LOCALE,
        params: {
          requestId: request.id,
          from: request.email,
          project: request.project_name ?? '—',
          topic: request.topic ?? '—',
          message: request.message,
          attachJournal: request.attach_journal ? 'да' : 'нет',
          services: request.services.join(', ') || '—',
          contact: request.contact ?? '—',
          preferredTime: request.preferred_time ?? '—',
        },
      },
      event.eventId,
    );
  }
}
