import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@workspace/ui/components/item';

import { NodeIcon, NodeStatus } from './knowledge-ui';

import type { KnowledgeNode } from '@/shared/api';

export function KnowledgeList({
  nodes,
  onOpen,
  locations,
}: {
  nodes: KnowledgeNode[];
  onOpen: (id: string) => void;
  locations?: Map<string, string>;
}) {
  return (
    <ItemGroup>
      {nodes.map((node) => {
        const location = locations?.get(node.id);
        return (
          <div key={node.id} role="listitem">
            <Item
              variant="muted"
              size="sm"
              className="flex-nowrap"
              render={
                <Link
                  href={{ pathname: '/knowledge', query: { page: node.id } }}
                  prefetch={false}
                  onNavigate={(event) => {
                    event.preventDefault();
                    onOpen(node.id);
                  }}
                />
              }
            >
              <ItemMedia
                variant="icon"
                className="size-9 rounded-lg border bg-background text-muted-foreground"
              >
                <NodeIcon kind={node.kind} />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="w-full wrap-anywhere">{node.title}</ItemTitle>
                {location && <ItemDescription className="text-xs wrap-anywhere">{location}</ItemDescription>}
              </ItemContent>
              <ItemActions>
                {node.kind === 'page' && <NodeStatus status={node.status} />}
                <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              </ItemActions>
            </Item>
          </div>
        );
      })}
    </ItemGroup>
  );
}
