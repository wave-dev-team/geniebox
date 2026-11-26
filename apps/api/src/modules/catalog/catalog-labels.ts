/**
 * Russian names for the catalog's version history and diff. The app keeps its own
 * localized copy in i18n; these are for texts the server writes once (journal, version lines).
 */
export const TOOL_TITLES: Record<string, string> = {
  'bot.reply': 'Отвечать клиентам',
  'bot.broadcast': 'Делать массовые рассылки',
  'bot.texts.update': 'Менять тексты в боте',
  'content.post': 'Публиковать посты',
  'promo.create': 'Создавать промокоды',
  'payments.read': 'Смотреть оплаты',
  'payments.refund': 'Делать возвраты',
  'analytics.read': 'Смотреть аналитику',
  'db.query': 'Запросы к базе в песочнице',
  'api.read': 'Читать данные через API',
  'api.call': 'Вызывать действия API',
  'monitoring.read': 'Смотреть мониторинг',
  'server.runbook': 'Выполнять инструкции на серверах',
  'server.restart': 'Перезапускать серверы',
  'code.read': 'Читать код',
  'code.mr.create': 'Создавать merge request',
  'code.mr.merge': 'Выпускать изменения',
  'web.search': 'Искать в интернете',
  'prices.update': 'Менять цены и тарифы',
  'customers.delete': 'Удалять клиентов и их данные',
  'policy.update': 'Менять свои права и лимиты',
  'ads.publish': 'Публиковать рекламу без «да» владельца',
};

export const ASK_TITLES: Record<string, string> = {
  discount_over_20: 'Давать скидку больше 20%',
  mailing_over_500: 'Писать больше чем 500 клиентам за раз',
  spend_over_10000: 'Тратить на промо больше 10 000 ₽ в месяц',
  release_changes: 'Выпускать изменения в работу',
  publish_on_behalf: 'Публиковать от имени проекта',
  bot_texts_change: 'Менять тексты в клиентском боте',
  public_reviews_reply: 'Отвечать на публичные отзывы',
  refund_any: 'Возвращать деньги клиентам',
  server_restart: 'Перезапускать серверы',
};

export const LIMIT_TITLES: Record<string, string> = {
  ai_budget_monthly: 'Бюджет на ИИ',
  promo_budget_monthly: 'Промо-бюджет',
  promo_codes_per_day: 'Промокодов в день',
  recipients_per_send: 'Получателей за одну рассылку',
  releases_per_week: 'Выпусков в неделю',
  quiet_hours: 'Тихие часы',
};

export const MODE_TITLES: Record<string, string> = {
  auto: 'Самостоятельно',
  notify: 'С уведомлением',
  approve: 'По согласованию',
  deny: 'Запрещено',
};

export const TRUST_TITLES: Record<string, string> = {
  approve_all: 'Согласовывать всё',
  approve_important: 'Согласовывать важное',
  autonomous: 'Самостоятельно в рамках лимитов',
};

export const PLAN_TITLES: Record<string, string> = {
  start: 'Старт',
  team: 'Команда',
  business: 'Бизнес',
};

export const MODEL_TITLES: Record<string, string> = {
  reasoning: 'Рассуждения и планирование',
  fast: 'Быстрые ответы',
};
