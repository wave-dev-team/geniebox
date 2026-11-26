import { Injectable, UnauthorizedException } from '@nestjs/common';

import type { ProfileUpdate } from '@workspace/types';

import { homeActor, type WorkspaceActor } from '../../common/auth/request-actor.js';
import { toProfile } from './dto/profile.dto.js';
import { UsersRepository } from './repositories/users.repository.js';

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async profile(actor: WorkspaceActor) {
    const profile = await this.repository.find(homeActor(actor));
    if (!profile) throw new UnauthorizedException();
    return toProfile(profile, actor.tenantId);
  }

  async update(actor: WorkspaceActor, input: ProfileUpdate) {
    const profile = await this.repository.update(homeActor(actor), input);
    return toProfile(profile, actor.tenantId);
  }
}
