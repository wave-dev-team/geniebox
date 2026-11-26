import { Construction } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export async function SectionPlaceholder({ section }: { section: string }) {
  const t = await getTranslations();
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <Construction aria-hidden="true" className="mb-2 size-6 text-muted-foreground" />
      <h1 className="text-xl font-semibold">{t(`sections.${section}`)}</h1>
      <p className="text-sm text-muted-foreground">{t('app.placeholder')}</p>
    </div>
  );
}
