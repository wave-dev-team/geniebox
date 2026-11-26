import { useTranslations } from 'next-intl';

export function OrSeparator() {
  const t = useTranslations('auth');
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      {t('or')}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
