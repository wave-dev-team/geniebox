import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';

import { type Knowledge, useKnowledgeError } from '../model/knowledge';
import { EmptyState, KnowledgeMarkdown } from './knowledge-ui';

import type { KnowledgeNode, KnowledgeProposal } from '@/shared/api';

export function KnowledgeProposals({
  knowledge,
  proposals,
  byId,
  canPublish,
  onOpen,
}: {
  knowledge: Knowledge;
  proposals: KnowledgeProposal[];
  byId: Map<string, KnowledgeNode>;
  canPublish: boolean;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations('knowledge');
  const format = useFormatter();
  const client = useQueryClient();
  const message = useKnowledgeError();
  const resolve = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      accept ? knowledge.api.acceptProposal(id) : knowledge.api.rejectProposal(id),
    onSuccess: (proposal, { accept }) => {
      client.setQueryData<KnowledgeProposal[]>(knowledge.keys.proposals, (items) =>
        items?.filter(({ id }) => id !== proposal.id),
      );
      void client.invalidateQueries({ queryKey: knowledge.keys.proposals });
      const { nodeId } = proposal.payload;
      if (accept && typeof nodeId === 'string') {
        void client.invalidateQueries({ queryKey: knowledge.keys.node(nodeId) });
        void client.invalidateQueries({ queryKey: knowledge.keys.history(nodeId) });
      }
      knowledge.refreshLibrary();
      toast.success(t(!accept ? 'rejected' : proposal.kind === 'gap' ? 'gapAccepted' : 'accepted'));
    },
    onError: (error) => toast.error(message(error)),
  });
  return (
    <section>
      {!proposals.length ? (
        <EmptyState icon={MessagesSquare} title={t('noProposals')} />
      ) : (
        <ul className="grid gap-3">
          {proposals.map((proposal) => {
            const { title, question, reason, body, nodeId } = proposal.payload;
            const page = typeof nodeId === 'string' ? byId.get(nodeId) : undefined;
            const heading =
              typeof title === 'string' && title.trim()
                ? title
                : typeof question === 'string' && question.trim()
                  ? question
                  : page?.title;
            return (
              <li key={proposal.id} className="min-w-0 space-y-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{t(`proposalKind.${proposal.kind}`)}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {format.dateTime(new Date(proposal.createdAt), { dateStyle: 'medium' })}
                  </span>
                </div>
                {heading && <h3 className="font-medium wrap-anywhere">{heading}</h3>}
                {typeof reason === 'string' && reason.trim() && (
                  <p className="text-sm wrap-anywhere text-muted-foreground">{reason}</p>
                )}
                {typeof body === 'string' && body.trim() && (
                  <details className="rounded-lg bg-muted/55 p-3">
                    <summary className="cursor-pointer text-sm font-medium">{t('proposalContent')}</summary>
                    <div className="mt-3">
                      <KnowledgeMarkdown body={body} />
                    </div>
                  </details>
                )}
                <div className="flex flex-wrap gap-2">
                  {page && (
                    <Button variant="ghost" onClick={() => onOpen(page.id)}>
                      {t('openPage')}
                    </Button>
                  )}
                  {canPublish && (
                    <>
                      <Button
                        variant="outline"
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ id: proposal.id, accept: false })}
                      >
                        {t('reject')}
                      </Button>
                      <Button
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ id: proposal.id, accept: true })}
                      >
                        {t(proposal.kind === 'gap' ? 'acceptGap' : 'accept')}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
