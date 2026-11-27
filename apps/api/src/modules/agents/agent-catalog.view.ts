import { Injectable } from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';

import { UserDb } from '../../database/scoped-db.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { AgentCatalogDto, AgentTemplateDto } from './dto/agent.dto.js';

/**
 * The marketplace catalog: templates with published versions in the request
 * language. Without an account — what everyone sees; with one the user belongs to — also the
 * betas it is in. Hidden templates come with `listed: false` so hired agents keep their names.
 */
@Injectable()
export class AgentCatalogView {
  constructor(
    private readonly catalog: CatalogService,
    private readonly userDb: UserDb,
  ) {}

  async build(accountId: string | undefined): Promise<AgentCatalogDto> {
    const member = accountId ? await this.isMember(accountId) : false;
    const scope = member ? accountId! : null;
    const locale = I18nContext.current()?.lang?.startsWith('en') ? 'en' : 'ru';
    const templates = this.catalog.templates().flatMap((template) => {
      const version = this.catalog.published(template.key);
      if (!version) return [];
      return [
        AgentTemplateDto.from(version, {
          locale,
          listed: this.catalog.listedFor(template.key, scope),
          beta: template.availability === 'beta',
        }),
      ];
    });
    return AgentCatalogDto.build(templates);
  }

  private isMember(accountId: string): Promise<boolean> {
    return this.userDb.transaction(async (tx) => {
      const row = await tx.db
        .selectFrom('account_members')
        .select('account_id')
        .where('account_id', '=', accountId)
        .where('user_id', '=', tx.userId)
        .executeTakeFirst();
      return Boolean(row);
    });
  }
}
