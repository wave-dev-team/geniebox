import { Suspense } from 'react';

import { Skeleton } from '@workspace/ui/components/skeleton';

import { KnowledgeBase } from '@/features/knowledge-base/ui/knowledge-base';

export default function KnowledgePage() {
  return (
    <Suspense fallback={<Skeleton className="m-8 h-64 rounded-2xl" />}>
      <KnowledgeBase />
    </Suspense>
  );
}
