import { ApiProperty } from '@nestjs/swagger';

import type { SessionInfo } from '../sessions/session.store.js';

export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'True for the session making this request' })
  current: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ description: 'Last token refresh; precision is the access token lifetime' })
  lastActiveAt: Date;

  @ApiProperty({ nullable: true, type: String })
  userAgent: string | null;

  @ApiProperty({ nullable: true, type: String })
  ip: string | null;

  static from(session: SessionInfo, currentSessionId: string | undefined): SessionResponseDto {
    return {
      id: session.sessionId,
      current: session.sessionId === currentSessionId,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      userAgent: session.userAgent,
      ip: session.ip,
    };
  }
}
