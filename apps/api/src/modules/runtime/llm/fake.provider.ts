import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse, LlmToolCall } from './llm.types.js';

/**
 * Deterministic offline model for development and tests (LLM_PROVIDER=fake). It follows the
 * same contract as a real provider: reads the prompt, calls only the tools it was given, and
 * streams its text. Behaviour is keyword-based and intentionally simple.
 */
export class FakeProvider implements LlmProvider {
  readonly name = 'fake';

  complete(request: LlmRequest): Promise<LlmResponse> {
    const decision = this.decide(request);
    if (decision.text) {
      for (const word of decision.text.split(/(?<= )/)) request.onTextDelta?.(word);
    }
    const tokensIn = Math.ceil(
      request.messages.reduce((sum, m) => sum + ('content' in m ? m.content.length : 0), 0) / 4,
    );
    return Promise.resolve({
      text: decision.text,
      toolCalls: decision.calls,
      usage: { tokensIn, tokensOut: Math.ceil((decision.text.length + 40) / 4) },
    });
  }

  private decide(request: LlmRequest): { text: string; calls: LlmToolCall[] } {
    const tools = new Set(request.tools.map((tool) => tool.name));
    const toolResults = request.messages.filter((m) => m.role === 'tool');
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const ask = unwrapData(lastUser?.content ?? '').toLowerCase();
    const call = (name: string, args: Record<string, unknown>): { text: string; calls: LlmToolCall[] } =>
      tools.has(name)
        ? {
            text: '',
            calls: [{ id: `call_${toolResults.length}_${name}`, name, arguments: JSON.stringify(args) }],
          }
        : { text: 'Готово.', calls: [] };

    if (request.role === 'agent.task') return this.task(request, ask, tools, toolResults, call);
    // Catalog scenarios: a careful answer, and a judge that fails only on «[fail]».
    if (request.role === 'catalog.scenario') {
      return {
        text: 'Сам этого делать не буду: подготовлю решение и отправлю владельцу на согласование.',
        calls: [],
      };
    }
    if (request.role === 'catalog.judge') {
      const fail = /\[fail\]/i.test(lastUser?.content ?? '');
      return {
        text: JSON.stringify({
          pass: !fail,
          reason: fail ? 'Ответ не совпал с ожиданием' : 'Ответ соответствует ожиданию',
        }),
        calls: [],
      };
    }

    // Conversations: the manager delegates, an agent answers itself.
    const last = request.messages[request.messages.length - 1];
    if (last?.role === 'tool') return { text: this.summary(request.messages), calls: [] };
    const team = teamFrom(request.messages);
    // Panel parity: what the owner asks to change in the panel, the manager does
    // with panel tools as that person.
    if (request.role === 'manager.turn') {
      const hire = /(?:найми|нанять|наймите)\s+(\S+)/.exec(ask);
      if (hire?.[1]) {
        const templateKey = TEMPLATE_WORDS.find(([pattern]) => pattern.test(hire[1]!))?.[1];
        if (templateKey) return call('panel_hire_agent', { templateKey });
      }
      if (/поставь команду на паузу|останови команду/.test(ask)) return call('panel_pause_team', {});
      if (/график/.test(ask)) return call('send_chart', { metricKey: 'revenue', days: 30 });
      if (/предложи варианты|дай варианты/.test(ask)) {
        return call('offer_buttons', {
          buttons: [
            { label: 'Вернуть ушедших', reply: 'Верни ушедших клиентов' },
            { label: 'Посмотреть сводку', reply: 'Как дела за неделю?' },
          ],
        });
      }
    }
    const wantsWork = /подготов|сделай|проверь|разбер|запусти|напиши|найди|посчитай|верн|почему|поручи/.test(
      ask,
    );
    if (request.role === 'manager.turn' && wantsWork && tools.has('assign_task') && team.length) {
      const agent = pickAgent(team, ask);
      const title = taskTitle(ask);
      return call('assign_task', {
        agentId: agent.id,
        title,
        why: `Запрос владельца: ${title.toLowerCase()}`,
        steps: ['Собрать данные', 'Разобраться в причинах', 'Подготовить вывод'],
      });
    }
    if (request.role === 'agent.turn' && /скидк|акци/.test(ask) && tools.has('propose_decision')) {
      return call('propose_decision', sampleDecision());
    }
    if (
      tools.has('project_overview') &&
      toolResults.length === 0 &&
      /как дела|что нового|сутки|итог/.test(ask)
    ) {
      return call('project_overview', {});
    }
    if (request.role === 'manager.turn' && !team.length) {
      return {
        text: 'В команде пока нет агентов. Добавьте их в маркетплейсе — и я начну поручать им задачи.',
        calls: [],
      };
    }
    return {
      text: 'Понял. Пока подробных данных мало: подключите источники, и я смогу ответить точнее.',
      calls: [],
    };
  }

  private task(
    request: LlmRequest,
    ask: string,
    tools: Set<string>,
    toolResults: LlmMessage[],
    call: (name: string, args: Record<string, unknown>) => { text: string; calls: LlmToolCall[] },
  ): { text: string; calls: LlmToolCall[] } {
    const stage = toolResults.length;
    // A check of an earlier proposal: look at the official metric, then record the verdict.
    if (tools.has('record_check')) {
      if (stage === 0 && tools.has('metrics_read')) return call('metrics_read', { key: 'revenue', days: 30 });
      return call('record_check', {
        verdict: 'worked',
        result: 'Сработало: у группы со скидкой вернулось больше клиентов, чем в контроле.',
        effectValue: 21000,
        comparison: '9% вернулись против 4% у контроля',
        confidence: 'надёжно, выборка 860 клиентов',
        sample: 860,
        outcome: 'Оставили для всех',
      });
    }
    if (stage === 0) {
      return call('report_progress', {
        steps: ['Собрать данные', 'Разобраться', 'Подготовить итог'],
        progressText: 'шаг 1 из 3',
        progressPct: 30,
      });
    }
    if (stage === 1) {
      const reader = ['analytics_read', 'payments_read', 'project_overview'].find((name) => tools.has(name));
      if (reader) return call(reader, reader === 'project_overview' ? {} : { days: 7 });
    }
    if (/скидк|акци|рассыл|верн|выпус/.test(ask) && tools.has('propose_decision') && stage <= 2) {
      return call('propose_decision', sampleDecision());
    }
    const published = toolResults.some((m) => 'content' in m && m.content.includes('"insightId"'));
    if (/итог/.test(ask) && tools.has('publish_insight') && !published) {
      return call('publish_insight', {
        text: 'За сутки команда закрыла задачи без сбоев; срочных решений нет.',
        facts: [
          { label: 'Задач за сутки', value: 'по данным проекта', highlight: false },
          { label: 'Решений ждут', value: 'см. сводку', highlight: true },
        ],
        note: 'Посчитано по задачам и решениям проекта за последние сутки.',
        periodDays: 1,
      });
    }
    return call('finish_task', {
      result: `Готово: ${taskTitle(ask).toLowerCase()}. Данных пока немного — вывод предварительный.`,
      summary: 'готово',
      facts: [{ label: 'Источник', value: 'данные проекта' }],
    });
  }

  private summary(messages: LlmMessage[]): string {
    const last = messages[messages.length - 1];
    const content = last && 'content' in last ? last.content : '';
    if (content.includes('"taskId"'))
      return 'Поручил задачу агенту — результат появится здесь, когда он закончит.';
    if (content.includes('"decisionId"')) return 'Подготовил предложение — нужно ваше решение.';
    if (content.includes('"awaiting_confirmation"'))
      return 'Подготовил — подтвердите кнопкой под этим сообщением.';
    if (content.includes('"forbidden"')) return 'У вашей роли нет прав на это — попросите владельца.';
    if (content.includes('"added"')) return 'Выберите вариант:';
    if (content.includes('"attached"')) return 'Вот график выручки за 30 дней.';
    if (content.includes('"status":"done"')) return 'Сделано.';
    return 'Посмотрел, что происходит в проекте. Срочного ничего нет.';
  }
}

interface TeamEntry {
  id: string;
  name: string;
  template: string | null;
}

function teamFrom(messages: LlmMessage[]): TeamEntry[] {
  const system = messages.find((m) => m.role === 'system');
  const match = system?.content.match(/<team>\n([\s\S]*?)\n<\/team>/);
  if (!match?.[1]) return [];
  try {
    return JSON.parse(match[1]) as TeamEntry[];
  } catch {
    return [];
  }
}

const TEMPLATE_WORDS: Array<[RegExp, string]> = [
  [/маркетолог/, 'marketer'],
  [/аналитик/, 'analyst'],
  [/разведк/, 'intel'],
  [/безопасник/, 'security'],
  [/инженер/, 'engineer'],
  [/поддержк/, 'support'],
];

const ROUTING: Array<[RegExp, string]> = [
  [/скидк|акци|ушедш|верн|промо|рассыл/, 'marketer'],
  [/почему|метрик|уход|отток|выручк|когорт/, 'analyst'],
  [/сервер|узел|нагрузк|мониторинг/, 'engineer'],
  [/баг|ошибк|код|исправ/, 'developer'],
  [/обращен|клиент|поддержк/, 'support'],
  [/пост|текст|отзыв/, 'content'],
];

function pickAgent(team: TeamEntry[], ask: string): TeamEntry {
  for (const [pattern, template] of ROUTING) {
    if (!pattern.test(ask)) continue;
    const agent = team.find((entry) => entry.template === template);
    if (agent) return agent;
  }
  return team[0]!;
}

/** The fake reads only the owner's words: the first line inside the first data block. */
function unwrapData(content: string): string {
  const match = /<<<DATA [^\n]*>>>\n([^\n]*)/.exec(content);
  return (match?.[1] ?? content).trim();
}

function taskTitle(ask: string): string {
  const clean = ask.replace(/[?!.]+$/, '').trim();
  const title = clean.charAt(0).toUpperCase() + clean.slice(1);
  return title.length > 80 ? `${title.slice(0, 77)}…` : title || 'Задача';
}

function sampleDecision(): Record<string, unknown> {
  return {
    title: 'Вернуть ушедших скидкой 30%',
    meta: '992 клиента · 20% — контрольная группа',
    effect: '≈ +18 000 ₽/мес',
    cost: '≈ 5 400 ₽ скидки',
    risk: 'low',
    riskNote: 'скидка только ушедшим',
    why: ['За месяц ушли 1 240 клиентов', 'Половина ушедших в опросе назвали цену'],
    plan: [
      { label: 'Кому', value: '992 ушедших клиента' },
      { label: 'Контрольная группа', value: '20% — без скидки' },
      { label: 'Смотрим', value: 'сколько вернулось за 14 дней' },
    ],
    terms: {
      label: 'Скидка',
      proposed: '30',
      options: [
        { value: '20', label: '20%', effect: '≈ +12 000 ₽/мес', cost: '≈ 3 600 ₽ скидки' },
        { value: '30', label: '30%', effect: '≈ +18 000 ₽/мес', cost: '≈ 5 400 ₽ скидки' },
        { value: '40', label: '40%', effect: '≈ +21 000 ₽/мес', cost: '≈ 8 400 ₽ скидки' },
      ],
    },
    yesLabel: 'Запустить',
    yesText: 'Запустим завтра в 12:00',
    experiment: {
      metricKey: 'revenue',
      controlPct: 20,
      durationDays: 14,
      minSample: 200,
      guardrails: ['средний чек'],
    },
    check: { inDays: 14, what: 'Вернулись ли ушедшие со скидкой' },
  };
}
