import Link from 'next/link';
import { notFound } from 'next/navigation';

import { messages } from '@/i18n';

const sections = new Map(Object.entries(messages.sections));

export const dynamicParams = false;

export function generateStaticParams() {
  return Array.from(sections.keys(), (section) => ({ section }));
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const section = sections.get((await params).section);
  if (!section) {
    notFound();
  }

  return (
    <>
      <Link href="/" className="inline-flex min-h-11 items-center text-sm underline">
        {messages.overview}
      </Link>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{section.title}</h1>
      <p className="mt-3 text-muted-foreground">{section.description}</p>
      <p className="mt-8 rounded-lg border p-5">{messages.empty}</p>
    </>
  );
}
