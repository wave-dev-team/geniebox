import Link from 'next/link';

import { ApiStatus } from '@/features/api-status';
import { messages } from '@/i18n';

export default function HomePage() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{messages.title}</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">{messages.description}</p>
      <div className="mt-6">
        <ApiStatus />
      </div>
      <ul className="mt-6 grid list-none gap-4 sm:grid-cols-2">
        {Object.entries(messages.sections).map(([slug, section]) => (
          <li key={slug}>
            <Link href={`/${slug}`} className="block h-full rounded-lg border p-5 hover:bg-muted">
              <h2 className="font-medium">{section.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{section.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
