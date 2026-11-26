import { notFound } from 'next/navigation';

import { placeholderSections } from '@/shared/config/nav';
import { SectionPlaceholder } from '@/shared/ui/section-placeholder';

export const dynamicParams = false;

export function generateStaticParams() {
  return placeholderSections.map((section) => ({ section }));
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!placeholderSections.some((value) => value === section)) notFound();
  return <SectionPlaceholder section={section} />;
}
