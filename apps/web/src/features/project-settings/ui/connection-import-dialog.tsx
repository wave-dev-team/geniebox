'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Loader2, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  buildFragments,
  IMPORT_LIMITS,
  type ImportFragment,
  type ImportQuestion,
  type ImportResult,
  importSkeleton,
} from '@workspace/types';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Input } from '@workspace/ui/components/input';
import { Textarea } from '@workspace/ui/components/textarea';

import { projectConnectionsKey, type ProjectRef } from '@/entities/project/operations';
import { listConnectionProviders, projectOperations } from '@/shared/api';
import { useErrorMessage } from '@/shared/lib/api-error';
import { OptionSelect } from '@/shared/ui/option-select';

type AccessLevel = 'read' | 'read_write';

interface DraftGroup {
  key: string;
  providerKey: string;
  accessLevel: AccessLevel;
  /** Provider field → fragment id. Values stay in the browser until save. */
  fields: Record<string, string>;
  confidence: 'high' | 'low';
  missing: string[];
}

function mask(value: string): string {
  return value.length >= 12 ? `••••${value.slice(-4)}` : '••••';
}

/**
 * One popup for every way a person brings credentials: paste text, attach a .txt/.env/.md, or
 * both. The browser cuts the buffer into fragments and sends only their skeleton; the model
 * names fields by fragment id, the values are filled in here and go straight to the vault.
 */
export function ConnectionImportDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('projectSettings.importDialog');
  const providerT = useTranslations('onboarding');
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const operations = projectOperations(project.accountId, project.id);

  const providers = useQuery({
    queryKey: ['connection-providers'],
    queryFn: ({ signal }) => listConnectionProviders(signal),
  });
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftGroup[]>([]);
  const [questions, setQuestions] = useState<ImportQuestion[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);

  const fragments = useMemo(() => buildFragments(text), [text]);
  const fragmentById = useMemo(
    () => new Map(fragments.map((fragment) => [fragment.id, fragment])),
    [fragments],
  );
  const providerName = (key: string) =>
    providerT.has(`providers.${key}`) ? providerT(`providers.${key}`) : key;
  const fieldLabel = (key: string) =>
    providerT.has(`connectionFields.${key}`) ? providerT(`connectionFields.${key}`) : key;

  const job = useQuery({
    queryKey: ['connections-import', jobId],
    queryFn: () => operations.importStatus(jobId as string),
    enabled: Boolean(jobId),
    gcTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'done' || status === 'failed' ? false : 1_500;
    },
  });

  useEffect(() => {
    const data = job.data;
    if (!jobId || !data) return;
    if (data.status === 'done' && data.result) {
      setLastResult(data.result);
      setDrafts(data.result.items.map(toDraft));
      setQuestions(data.result.questions);
      setWarnings(data.result.notes);
      setFailure(null);
      setJobId(null);
    } else if (data.status === 'failed') {
      setFailure(data.error ?? 'CONNECTION_IMPORT_AI_UNAVAILABLE');
      setJobId(null);
    }
  }, [jobId, job.data]);

  const analyze = useMutation({
    mutationFn: () => operations.analyzeImport(importSkeleton(fragments, note)),
    onSuccess: ({ jobId: next }) => {
      setFailure(null);
      setJobId(next);
    },
  });

  const clarify = useMutation({
    mutationFn: (input: { question: ImportQuestion; answer: string }) =>
      operations.clarifyImport({
        skeleton: importSkeleton(fragments, note),
        question: input.question.text,
        answer: stripValues(input.answer, fragments),
        previous: lastResult ?? undefined,
      }),
    onSuccess: ({ jobId: next }) => setJobId(next),
  });

  const save = useMutation({
    mutationFn: () =>
      operations.importConnections(
        drafts
          .map((draft) => ({
            providerKey: draft.providerKey,
            accessLevel: draft.accessLevel,
            fields: Object.fromEntries(
              Object.entries(draft.fields)
                .map(([field, id]) => [field, fragmentById.get(id)?.value ?? ''])
                .filter(([, value]) => value !== ''),
            ),
          }))
          .filter((group) => Object.keys(group.fields).length > 0),
        'skip',
      ),
    onSuccess: async ({ items }) => {
      await client.invalidateQueries({ queryKey: projectConnectionsKey(project) });
      const created = items.filter((item) => item.outcome === 'created').length;
      const replaced = items.filter((item) => item.outcome === 'replaced').length;
      const skipped = items.filter((item) => item.outcome === 'skipped').length;
      const failed = items.filter((item) => item.outcome === 'failed').length;
      if (created + replaced > 0) toast.success(t('saved', { count: created + replaced }));
      if (skipped > 0) toast.info(t('skipped', { count: skipped }));
      if (failed > 0) toast.warning(t('someFailed', { count: failed }));
      close();
    },
  });

  function close() {
    if (save.isPending || analyze.isPending) return;
    setText('');
    setNote('');
    setJobId(null);
    setDrafts([]);
    setQuestions([]);
    setWarnings([]);
    setFailure(null);
    setLastResult(null);
    onOpenChange(false);
  }

  function toDraft(item: ImportResult['items'][number]): DraftGroup {
    return {
      key: crypto.randomUUID(),
      providerKey: item.providerKey,
      accessLevel: 'read',
      fields: Object.fromEntries(item.fields.map((entry) => [entry.field, entry.fragment])),
      confidence: item.confidence,
      missing: item.missing,
    };
  }

  function draftFromQuestion(question: ImportQuestion, providerKey: string) {
    const provider = providers.data?.find((entry) => entry.key === providerKey);
    if (!provider) return;
    const fields: Record<string, string> = {};
    const targets = [
      ...provider.fields.filter((field) => field.required),
      ...provider.fields.filter((field) => !field.required),
    ];
    for (const [index, id] of question.fragments.entries()) {
      const field = targets[index];
      if (field && !fields[field.key]) fields[field.key] = id;
    }
    setDrafts((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        providerKey,
        accessLevel: provider.accessLevels[0] ?? 'read',
        fields,
        confidence: 'low',
        missing: provider.fields
          .filter((field) => field.required && !fields[field.key])
          .map((field) => field.key),
      },
    ]);
    setQuestions((current) => current.filter((entry) => entry.id !== question.id));
  }

  async function attach(file: File | undefined) {
    if (!file) return;
    if (file.size > IMPORT_LIMITS.bytes) {
      toast.error(t('fileTooLarge'));
      return;
    }
    const content = await file.text();
    setText(content.slice(0, IMPORT_LIMITS.bytes));
  }

  const busy = analyze.isPending || clarify.isPending || Boolean(jobId);
  const review = drafts.length > 0 || questions.length > 0 || failure !== null;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {!review && (
          <div className="grid gap-3">
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value.slice(0, IMPORT_LIMITS.bytes))}
              placeholder={t('placeholder')}
              rows={9}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              className="font-mono text-xs"
            />
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('notePlaceholder')}
              maxLength={500}
              disabled={busy}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <input
                ref={fileInput}
                type="file"
                accept=".txt,.env,.md,text/plain"
                className="hidden"
                onChange={(event) => {
                  void attach(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <FileUp className="size-4" />
                {t('attach')}
              </Button>
              <Button
                type="button"
                disabled={busy || fragments.length === 0}
                onClick={() => analyze.mutate()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {busy ? t('analyzing') : t('analyze')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('limits', { count: fragments.length, max: IMPORT_LIMITS.fragments })}
            </p>
            {analyze.error && (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage(analyze.error)}
              </p>
            )}
          </div>
        )}

        {review && (
          <div className="grid gap-5">
            {failure && (
              <div className="rounded-lg border border-dashed px-4 py-3 text-sm">
                <p className="font-medium">
                  {failure === 'CONNECTION_IMPORT_AI_BUDGET' ? t('budget') : t('unavailable')}
                </p>
                <p className="mt-1 text-muted-foreground">{t('unavailableHint')}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3"
                  disabled={busy}
                  onClick={() => {
                    setFailure(null);
                    setDrafts([]);
                    setQuestions([
                      {
                        id: 'manual',
                        fragments: fragments.map((fragment) => fragment.id),
                        text: t('manualQuestion'),
                        options: providers.data?.map((provider) => provider.key) ?? [],
                        turn: 1,
                      },
                    ]);
                  }}
                >
                  {t('manual')}
                </Button>
              </div>
            )}

            <section className="grid gap-2">
              <h3 className="text-sm font-medium">{t('groups', { count: drafts.length })}</h3>
              {drafts.length === 0 && <p className="text-sm text-muted-foreground">{t('noGroups')}</p>}
              {drafts.map((draft) => {
                const provider = providers.data?.find((entry) => entry.key === draft.providerKey);
                const fields = provider?.fields ?? [];
                return (
                  <article key={draft.key} className="grid gap-3 rounded-xl border p-3">
                    <header className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {providerName(draft.providerKey)}
                        {draft.confidence === 'low' && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {t('guess')}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        {provider && provider.accessLevels.length > 1 && (
                          <OptionSelect
                            options={provider.accessLevels}
                            label={(level) => providerT(`accessLevels.${level}`)}
                            value={draft.accessLevel}
                            onChange={(level) =>
                              setDrafts((current) =>
                                current.map((entry) =>
                                  entry.key === draft.key
                                    ? { ...entry, accessLevel: level as AccessLevel }
                                    : entry,
                                ),
                              )
                            }
                            disabled={save.isPending}
                          />
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('remove')}
                          onClick={() =>
                            setDrafts((current) => current.filter((entry) => entry.key !== draft.key))
                          }
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    </header>
                    {Object.entries(draft.fields).map(([field, id]) => {
                      const fragment = fragmentById.get(id);
                      return (
                        <div
                          key={`${field}-${id}`}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2"
                        >
                          <label className="grid gap-1 text-xs text-muted-foreground">
                            {t('field')}
                            <select
                              className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
                              value={field}
                              disabled={save.isPending}
                              onChange={(event) => {
                                const nextField = event.target.value;
                                setDrafts((current) =>
                                  current.map((entry) => {
                                    if (entry.key !== draft.key) return entry;
                                    const nextFields = { ...entry.fields };
                                    if (nextField) nextFields[nextField] = id;
                                    if (nextField !== field) delete nextFields[field];
                                    return { ...entry, fields: nextFields };
                                  }),
                                );
                              }}
                            >
                              <option value="">{t('skipField')}</option>
                              {fields.map((option) => (
                                <option key={option.key} value={option.key}>
                                  {fieldLabel(option.key)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <code className="pb-1.5 text-xs">{fragment ? mask(fragment.value) : ''}</code>
                        </div>
                      );
                    })}
                    {draft.missing.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t('missing', { fields: draft.missing.map(fieldLabel).join(', ') })}
                      </p>
                    )}
                  </article>
                );
              })}
            </section>

            {questions.length > 0 && (
              <section className="grid gap-2">
                <h3 className="text-sm font-medium">{t('questions')}</h3>
                {questions.map((question) => (
                  <QuestionCard
                    key={question.id}
                    question={question}
                    providers={providers.data?.map((provider) => provider.key) ?? []}
                    options={question.options}
                    fragments={question.fragments
                      .map((id) => fragmentById.get(id))
                      .filter((fragment): fragment is ImportFragment => Boolean(fragment))}
                    pending={busy}
                    onPick={(providerKey) => draftFromQuestion(question, providerKey)}
                    onAsk={(answer) => clarify.mutate({ question, answer })}
                    providerName={providerName}
                  />
                ))}
              </section>
            )}

            {warnings.length > 0 && (
              <ul className="grid gap-1 text-xs text-muted-foreground">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}

            {clarify.error && (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage(clarify.error)}
              </p>
            )}
            {save.error && (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage(save.error)}
              </p>
            )}

            <div className="flex flex-wrap justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDrafts([]);
                  setQuestions([]);
                  setWarnings([]);
                  setFailure(null);
                  setLastResult(null);
                }}
              >
                {t('back')}
              </Button>
              <Button
                type="button"
                disabled={busy || save.isPending || drafts.length === 0}
                onClick={() => save.mutate()}
              >
                {save.isPending && <Loader2 className="size-4 animate-spin" />}
                {t('save', { count: drafts.length })}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuestionCard({
  question,
  providers,
  options,
  fragments,
  pending,
  onPick,
  onAsk,
  providerName,
}: {
  question: ImportQuestion;
  providers: string[];
  options: string[];
  fragments: ImportFragment[];
  pending: boolean;
  onPick: (providerKey: string) => void;
  onAsk: (answer: string) => void;
  providerName: (key: string) => string;
}) {
  const t = useTranslations('projectSettings.importDialog');
  const choices = options.length ? options : providers;
  const [providerKey, setProviderKey] = useState(choices[0] ?? '');
  const [answer, setAnswer] = useState('');

  return (
    <article className="grid gap-3 rounded-xl border border-dashed p-3">
      <p className="text-sm">{question.text}</p>
      <ul className="grid gap-1 text-xs">
        {fragments.map((fragment) => (
          <li key={fragment.id} className="flex flex-wrap justify-between gap-2 text-muted-foreground">
            <span>
              {t('line', { line: fragment.line })}: {fragment.key ?? fragment.label ?? t('value')}
            </span>
            <code>{mask(fragment.value)}</code>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('service')}
          <OptionSelect
            options={choices}
            label={providerName}
            value={providerKey}
            onChange={setProviderKey}
            disabled={pending || !choices.length}
          />
        </label>
        <Button type="button" disabled={pending || !providerKey} onClick={() => onPick(providerKey)}>
          {t('assign')}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder={t('answerPlaceholder')}
          maxLength={500}
          disabled={pending}
        />
        <Button
          type="button"
          variant="outline"
          disabled={pending || answer.trim().length < 2}
          onClick={() => {
            onAsk(answer.trim());
            setAnswer('');
          }}
        >
          {t('askAi')}
        </Button>
      </div>
    </article>
  );
}

/** Never send the person's own values to the model, even if they paste them into the answer. */
function stripValues(answer: string, fragments: ImportFragment[]): string {
  let text = answer;
  for (const fragment of fragments) {
    if (fragment.value.length < 4) continue;
    text = text.split(fragment.value).join('‹значение из буфера›');
  }
  return text.slice(0, 500);
}
