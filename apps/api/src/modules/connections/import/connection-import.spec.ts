import { buildFragments, importProposalSchema, importSkeleton } from '@workspace/types';

import { FakeProvider } from '../../runtime/llm/fake.provider.js';
import { validateProposal, withHints } from './connection-import.prompt.js';

describe('buildFragments', () => {
  it('reads dotenv lines and export', () => {
    const fragments = buildFragments('YOOKASSA_SHOP_ID=123456\nexport TELEGRAM_BOT_TOKEN="123:abc"\n');
    expect(fragments.map((fragment) => [fragment.key, fragment.value])).toEqual([
      ['YOOKASSA_SHOP_ID', '123456'],
      ['TELEGRAM_BOT_TOKEN', '123:abc'],
    ]);
  });

  it('reads labelled pairs and bare pairs', () => {
    const fragments = buildFragments('Логин: admin\nПароль — qwerty\nadmin qwerty\n');
    expect(fragments.map((fragment) => [fragment.key, fragment.value, fragment.part])).toEqual([
      ['Логин', 'admin', 'value'],
      ['Пароль', 'qwerty', 'value'],
      [undefined, 'admin', 'left'],
      [undefined, 'qwerty', 'right'],
    ]);
  });

  it('keeps a bare token with a colon as one value', () => {
    const fragments = buildFragments('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw\n');
    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({
      part: 'value',
      value: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    });
    expect(fragments[0]!.key).toBeUndefined();
    // Only the mask-like prefix may reach the model, never the token's own digits.
    const skeleton = JSON.stringify(importSkeleton(fragments));
    expect(skeleton).not.toContain('123456789');
    expect(skeleton).toContain('"prefix":"1234"');
  });

  it('does not split urls, comments or PEM bodies', () => {
    const fragments = buildFragments(
      '# комментарий\nhttps://api.example.com/v1?x=1\n-----BEGIN KEY-----\nabc\n-----END KEY-----\n',
    );
    expect(fragments).toHaveLength(2);
    expect(fragments[0]?.value).toBe('https://api.example.com/v1?x=1');
    expect(fragments[1]?.key).toBe('pem');
  });

  it('never puts values into the skeleton', () => {
    const fragments = buildFragments('YOOKASSA_SECRET_KEY=live_super_secret_value\n');
    const skeleton = JSON.stringify(importSkeleton(fragments, 'это доступы'));
    expect(skeleton).not.toContain('live_super_secret_value');
    expect(skeleton).not.toContain('super_secret');
    expect(skeleton).toContain('YOOKASSA_SECRET_KEY');
    expect(skeleton).toContain('live');
  });
});

describe('withHints', () => {
  it('guesses a provider from the variable name', () => {
    const skeleton = importSkeleton(buildFragments('YOOKASSA_SHOP_ID=123456\nMETRIKA_COUNTER_ID=42\n'));
    const hinted = withHints(skeleton);
    expect(hinted.fragments.map((fragment) => fragment.providerHint)).toEqual(['yookassa', 'yandex_metrika']);
  });
});

describe('validateProposal', () => {
  const skeleton = importSkeleton(
    buildFragments('YOOKASSA_SHOP_ID=123456\nYOOKASSA_SECRET_KEY=live_key\nunknown_value\n'),
  );

  it('keeps valid assignments and reports unmatched fragments', () => {
    const proposal = importProposalSchema.parse({
      items: [
        {
          providerKey: 'yookassa',
          fields: [
            { field: 'shop_id', fragment: 'f1' },
            { field: 'secret_key', fragment: 'f2' },
          ],
          confidence: 'high',
        },
      ],
    });
    const result = validateProposal(skeleton, proposal);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.missing).toEqual([]);
    expect(result.unmatched).toEqual(['f3']);
  });

  it('drops unknown providers, fields and reused fragments, and asks about missing ones', () => {
    const proposal = importProposalSchema.parse({
      items: [
        {
          providerKey: 'nope',
          fields: [{ field: 'shop_id', fragment: 'f1' }],
        },
        {
          providerKey: 'yookassa',
          fields: [{ field: 'shop_id', fragment: 'f1' }],
        },
        {
          providerKey: 'yookassa',
          fields: [{ field: 'secret_key', fragment: 'f1' }],
        },
      ],
      questions: [{ fragments: ['f2', 'f99'], text: 'Что это?', options: ['yookassa', 'nope'] }],
    });
    const result = validateProposal(skeleton, proposal);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.providerKey).toBe('yookassa');
    expect(result.items[0]?.missing).toEqual(['secret_key']);
    expect(result.questions[0]?.text).toContain('secret_key');
    expect(result.questions.some((question) => question.text === 'Что это?')).toBe(true);
    expect(result.questions.flatMap((question) => question.options)).not.toContain('nope');
    expect(result.unmatched).toEqual(['f3']);
  });
});

describe('FakeProvider connections import', () => {
  it('proposes providers for a dotenv buffer without values', async () => {
    const skeleton = importSkeleton(
      buildFragments('YOOKASSA_SHOP_ID=123456\nYOOKASSA_SECRET_KEY=live_key\n'),
    );
    const provider = new FakeProvider();
    const response = await provider.complete({
      role: 'connections.import',
      model: 'fake',
      messages: [
        { role: 'system', content: 'import' },
        { role: 'user', content: `Skeleton: ${JSON.stringify(withHints(skeleton))}` },
      ],
      tools: [
        {
          name: 'propose_credentials',
          description: 'propose',
          parameters: { type: 'object' },
        },
      ],
      maxTokens: 500,
      timeoutMs: 1_000,
    });
    const call = response.toolCalls[0];
    expect(call?.name).toBe('propose_credentials');
    const args = JSON.parse(call?.arguments ?? '{}');
    expect(args.items[0]?.providerKey).toBe('yookassa');
    expect(args.items[0]?.fields).toEqual([
      { field: 'shop_id', fragment: 'f1' },
      { field: 'secret_key', fragment: 'f2' },
    ]);
  });
});
