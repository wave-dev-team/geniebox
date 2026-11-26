import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { I18nService } from 'nestjs-i18n';

import { localeSchema } from '@workspace/types';

import { homeActor, type WorkspaceActor } from '../../common/auth/request-actor.js';
import { MailEnvelope } from '../mail/mail-envelope.js';
import { ProfileRepository } from '../profile/profile.repository.js';
import { AccountsRepository } from './accounts.repository.js';

const inviteLifetime = 7 * 24 * 60 * 60 * 1000;
const hash = (code: string) => createHash('sha256').update(code).digest('hex');

@Injectable()
export class AccountsService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly profiles: ProfileRepository,
    private readonly mail: MailEnvelope,
    private readonly context: ClsService,
    private readonly i18n: I18nService,
  ) {}

  async list(actor: WorkspaceActor) {
    return { activeId: actor.tenantId, workspaces: await this.accounts.list(homeActor(actor)) };
  }

  async authorizeSelection(actor: WorkspaceActor, id: string) {
    if (!(await this.accounts.role(id, homeActor(actor)))) throw new NotFoundException();
  }

  async rename(actor: WorkspaceActor, name: string) {
    await this.requireOwner(actor);
    await this.accounts.rename(actor.tenantId, actor.userId, name);
  }

  async members(actor: WorkspaceActor) {
    const rows = await this.accounts.listMembers(actor.tenantId);
    return Promise.all(
      rows.map(async (row) => ({
        id: row.user_id,
        role: row.role,
        name: await this.profiles.name({ tenantId: row.home_tenant_id, userId: row.user_id }),
      })),
    );
  }

  async invite(actor: WorkspaceActor, email: string) {
    await this.requireOwner(actor);
    const profile = await this.profiles.find(homeActor(actor));
    if (!profile?.email_verified_at) throw new ForbiddenException();

    const code = randomBytes(32).toString('base64url');
    const expiry = new Date(Date.now() + inviteLifetime);
    const lang = localeSchema.parse(profile.locale);
    const envelope = this.mail.seal(actor.tenantId, this.context.getId() ?? randomUUID(), expiry, {
      to: email,
      subject: this.i18n.translate('accounts.invite.subject', { lang }),
      text: this.i18n.translate('accounts.invite.body', { lang, args: { code } }),
    });
    await this.accounts.saveInvitation(actor.tenantId, email, hash(code), expiry, envelope);
  }

  async join(actor: WorkspaceActor, code: string) {
    const identity = homeActor(actor);
    const profile = await this.profiles.find(identity);
    if (!profile?.email_verified_at) throw new ForbiddenException();
    const tenantId = await this.accounts.join(identity, profile.email, hash(code));
    if (!tenantId) throw new NotFoundException();
    return tenantId;
  }

  private async requireOwner(actor: WorkspaceActor) {
    if ((await this.accounts.role(actor.tenantId, homeActor(actor))) !== 'owner') {
      throw new ForbiddenException();
    }
  }
}
