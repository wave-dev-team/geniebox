import '@workspace/ui/globals.css';

import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Providers } from './providers';

import { messages } from '@/i18n';

export const metadata: Metadata = { title: messages.brand, description: messages.description };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen font-sans antialiased">
        <header className="border-b">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-8 gap-y-1 px-5 py-3">
            <Link href="/" className="inline-flex min-h-11 items-center font-semibold">
              {messages.brand}
            </Link>
            <nav aria-label={messages.navigation} className="flex flex-wrap gap-x-4 text-sm">
              {Object.entries(messages.sections).map(([slug, section]) => (
                <Link
                  key={slug}
                  href={`/${slug}`}
                  className="inline-flex min-h-11 items-center hover:underline"
                >
                  {section.title}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-5 py-10 sm:py-16">
          <Providers>{children}</Providers>
        </main>
      </body>
    </html>
  );
}
