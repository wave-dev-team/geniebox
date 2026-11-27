import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { ConversationRow, MessageRow } from '../repositories/conversations.repository.js';
import type { MessageActionRow } from '../repositories/message-actions.repository.js';
import { MESSAGE_STATUSES, type MessageStatus, REQUEST_MODES, type RequestMode } from '../work.constants.js';
import { CardDto } from './common.dto.js';

export class ConversationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'The manager or the agent of the dialog' })
  agentId: string;

  @ApiProperty({ nullable: true, type: String })
  title: string | null;

  @ApiProperty()
  lastMessageAt: Date;

  @ApiProperty()
  createdAt: Date;

  static from(row: ConversationRow): ConversationResponseDto {
    return {
      id: row.id,
      agentId: row.agent_id,
      title: row.title,
      lastMessageAt: row.last_message_at,
      createdAt: row.created_at,
    };
  }
}

export class MessageActionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['reply', 'action', 'link', 'decision'] })
  kind: 'reply' | 'action' | 'link' | 'decision';

  @ApiProperty()
  label: string;

  @ApiProperty({ nullable: true, type: String, description: 'link: the panel page' })
  url: string | null;

  @ApiProperty({ enum: ['pending', 'done', 'failed', 'expired'] })
  status: 'pending' | 'done' | 'failed' | 'expired';

  @ApiProperty({ nullable: true, type: String, description: 'What pressing did' })
  result: string | null;

  static from(row: MessageActionRow): MessageActionDto {
    const expired = row.status === 'pending' && row.expires_at.getTime() < Date.now();
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      url: row.kind === 'link' && 'url' in row.payload ? row.payload.url : null,
      status: expired ? 'expired' : row.status,
      result: row.result,
    };
  }
}

export class MessageResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  conversationId: string;

  @ApiProperty({ enum: ['user', 'assistant', 'system'] })
  role: 'user' | 'assistant' | 'system';

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  agentId: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  authorUserId: string | null;

  @ApiProperty()
  text: string;

  @ApiProperty({ enum: MESSAGE_STATUSES })
  status: MessageStatus;

  @ApiProperty({ enum: REQUEST_MODES, nullable: true })
  mode: RequestMode | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  mentionAgentId: string | null;

  @ApiProperty({ type: [CardDto] })
  cards: CardDto[];

  @ApiProperty({ enum: ['web'] })
  channel: 'web';

  @ApiPropertyOptional({ nullable: true, type: String })
  notificationKind: string | null;

  @ApiProperty({ type: [MessageActionDto] })
  actions: MessageActionDto[];

  @ApiProperty()
  createdAt: Date;

  static from(row: MessageRow, actions: MessageActionRow[] = []): MessageResponseDto {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as MessageResponseDto['role'],
      agentId: row.agent_id,
      authorUserId: row.author_user_id,
      text: row.text,
      status: row.status,
      mode: row.mode,
      mentionAgentId: row.mention_agent_id,
      cards: row.cards,
      channel: 'web',
      notificationKind: row.notification_kind,
      actions: actions.map((action) => MessageActionDto.from(action)),
      createdAt: row.created_at,
    };
  }
}

export class ConversationListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agentId?: string;
}

export class CreateConversationDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Defaults to the manager' })
  @IsOptional()
  @IsUUID()
  agentId?: string;
}

export class MessageListQueryDto {
  @ApiPropertyOptional({ description: 'Messages created before this moment (paging back)' })
  @IsOptional()
  @IsISO8601()
  before?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Page back from this message, including messages with the same timestamp',
  })
  @IsOptional()
  @IsUUID()
  beforeId?: string;
}

export class PostMessageDto {
  @ApiProperty({ maxLength: 4000 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 4000)
  text: string;

  @ApiPropertyOptional({ enum: REQUEST_MODES, default: 'approve_all' })
  @IsOptional()
  @IsIn(REQUEST_MODES)
  mode?: RequestMode;

  @ApiPropertyOptional({ format: 'uuid', description: '«@agent»: the agent answers directly' })
  @IsOptional()
  @IsUUID()
  mentionAgentId?: string;
}

export class PostMessageResponseDto {
  @ApiProperty({ type: MessageResponseDto })
  message: MessageResponseDto;

  @ApiProperty({ type: MessageResponseDto, description: 'Streaming reply placeholder' })
  reply: MessageResponseDto;
}
