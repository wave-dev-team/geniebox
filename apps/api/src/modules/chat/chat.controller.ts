import { z } from 'zod';

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiAcceptedResponse, ApiTags } from '@nestjs/swagger';

import { sendChatMessageSchema } from '@workspace/types';

import type { AuthenticatedRequest } from '../auth/auth.controller.js';
import { ChatService } from './chat.service.js';

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  history(@Req() request: AuthenticatedRequest, @Query('before') before?: string) {
    const cursor = z.uuid().optional().safeParse(before);
    if (!cursor.success) throw new BadRequestException();
    return this.chat.history(request.user, cursor.data);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @HttpCode(202)
  @ApiAcceptedResponse({ description: 'Message saved and accepted for generation' })
  async send(@Req() request: AuthenticatedRequest, @Body() input: unknown) {
    const message = sendChatMessageSchema.safeParse(input);
    if (!message.success) throw new BadRequestException();
    if (!this.chat.enabled) throw new ServiceUnavailableException();
    const turn = await this.chat.submit(request.user, message.data);
    if (!turn) throw new ConflictException();
    return turn;
  }
}
