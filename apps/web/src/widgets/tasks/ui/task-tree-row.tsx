'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ProjectAgent, ProjectTask } from '@workspace/types';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { cn } from '@workspace/ui/lib/utils';

import { TaskStatusBadge } from './task-status-badge';

import { AgentIcon } from '@/entities/agent/ui/agent-icon';

export function buildTaskTree(tasks: ProjectTask[]) {
  const byId = new Map<string, ProjectTask>();
  for (const task of tasks) {
    byId.set(task.id, task);
  }
  const childrenMap = new Map<string, ProjectTask[]>();
  const roots: ProjectTask[] = [];
  for (const task of tasks) {
    if (task.parentTaskId && byId.has(task.parentTaskId)) {
      const list = childrenMap.get(task.parentTaskId) ?? [];
      list.push(task);
      childrenMap.set(task.parentTaskId, list);
    } else {
      roots.push(task);
    }
  }
  return { roots, childrenMap };
}

export function TaskTreeRow({
  task,
  depth,
  childrenMap,
  agentsMap,
  expandedIds,
  onToggleExpand,
  onSelect,
}: {
  task: ProjectTask;
  depth: number;
  childrenMap: Map<string, ProjectTask[]>;
  agentsMap: Map<string, ProjectAgent>;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('tasksSection');
  const children = childrenMap.get(task.id) ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(task.id);
  const agent = agentsMap.get(task.agentId);
  const delegator = task.assignedByAgentId ? agentsMap.get(task.assignedByAgentId) : undefined;

  return (
    <div className="divide-y-0">
      <div
        className={cn(
          'flex items-center gap-2 border-b px-3 py-3 transition-colors hover:bg-muted/40 sm:px-4',
          depth > 0 && 'bg-muted/15',
        )}
        style={{ paddingLeft: `${12 + Math.min(depth, 3) * 24}px` }}
      >
        {hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={isExpanded ? t('tree.collapse') : t('tree.expand')}
            onClick={() => onToggleExpand(task.id)}
            className="size-6 shrink-0 text-muted-foreground"
          >
            {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>
        ) : (
          <span className="w-6 shrink-0" />
        )}

        <Button
          type="button"
          variant="ghost"
          onClick={() => onSelect(task.id)}
          className="h-auto min-w-0 flex-1 justify-between gap-3 px-1 py-0.5 text-left font-normal hover:bg-transparent"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium">{task.title}</p>
              {hasChildren && (
                <Badge variant="outline" className="text-[11px]">
                  {t('tree.subtasksCount', { count: children.length })}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {agent && (
                <span className="inline-flex items-center gap-1.5">
                  <AgentIcon icon={agent.icon} size="sm" />
                  <span>{agent.displayName}</span>
                </span>
              )}
              {delegator && delegator.id !== agent?.id && (
                <span>{t('tree.delegatedBy', { name: delegator.displayName })}</span>
              )}
              {task.progressText && task.status === 'running' && (
                <span className="truncate text-foreground/80">{task.progressText}</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <TaskStatusBadge task={task} />
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </div>
        </Button>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {children.map((child) => (
            <TaskTreeRow
              key={child.id}
              task={child}
              depth={depth + 1}
              childrenMap={childrenMap}
              agentsMap={agentsMap}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
