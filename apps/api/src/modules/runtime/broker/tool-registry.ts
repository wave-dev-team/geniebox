import { Injectable } from '@nestjs/common';

import { CatalogService, versionToolIds } from '../../catalog/catalog.service.js';
import type { BrokerTool, RuntimeAgent, ToolAudience } from './broker.types.js';

/** Tools implemented in the broker. Modules register theirs in onModuleInit. */
@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, BrokerTool>();

  constructor(private readonly catalog: CatalogService) {}

  register(tool: BrokerTool): void {
    if (this.tools.has(tool.id)) throw new Error(`Tool ${tool.id} is already registered`);
    if (tool.schema._zod.def.catchall?._zod.def.type !== 'never') {
      throw new Error(`Tool ${tool.id} schema must be strict`);
    }
    this.tools.set(tool.id, tool);
  }

  get(id: string): BrokerTool | undefined {
    return this.tools.get(id);
  }

  all(): BrokerTool[] {
    return [...this.tools.values()];
  }

  /**
   * What an agent may be offered: platform tools of its audience plus catalog tools its role
   * has (template or custom set). The role decides, never the prompt.
   */
  available(
    agent: RuntimeAgent,
    audience: ToolAudience,
    exclude: string[] = [],
    work: { check?: boolean; conversation?: boolean } = {},
  ): BrokerTool[] {
    const roleTools = new Set(this.roleToolIds(agent));
    return [...this.tools.values()].filter(
      (tool) =>
        tool.audience.includes(audience) &&
        !exclude.includes(tool.id) &&
        (tool.scope !== 'check' || work.check === true) &&
        (tool.scope !== 'conversation' || work.conversation === true) &&
        (tool.kind === 'platform' || roleTools.has(tool.id)),
    );
  }

  /** Catalog tools of the agent's role: its catalog version, or the custom agent's set. */
  roleToolIds(agent: RuntimeAgent): string[] {
    if (agent.kind === 'manager') return [];
    const version = this.catalog.forAgent(agent);
    if (agent.templateKey) return version ? versionToolIds(version) : [];
    return agent.customTools;
  }
}
