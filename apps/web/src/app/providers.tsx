'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';

import { TooltipProvider } from '@workspace/ui/components/tooltip';

import { ThemeProvider } from '@/core/providers/theme-provider';
import { ConfirmProvider } from '@/shared/ui/confirm-dialog';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
      }),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider delay={300}>
          <ConfirmProvider>{children}</ConfirmProvider>
          <Toaster position="bottom-center" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
