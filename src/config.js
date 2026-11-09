// Konfiguráció környezeti változókból (.env-et a futtató környezet tölti be, pl. Render, vagy `node --env-file=.env`).

const list = (v, d) => (v ?? d).split(',').map((s) => s.trim()).filter(Boolean);
const num = (v, d) => (v === undefined || v === '' ? d : Number(String(v).split('#')[0].trim()));

export function loadConfig(rawEnv = process.env) {
  // Sor végi "# megjegyzés" levágása (egyes .env-betöltők nem teszik meg).
  const env = Object.fromEntries(Object.entries(rawEnv).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/\s+#.*$/, '').trim() : v]));
  return {
    oddsApiKey: env.ODDS_API_KEY,
    databaseUrl: env.DATABASE_URL,
    telegramToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: env.TELEGRAM_CHAT_ID || '',

    sports: list(env.SPORTS, 'soccer_epl,soccer_uefa_champs_league,basketball_euroleague'),
    markets: list(env.MARKETS, 'h2h,totals,spreads'),
    sharpBook: env.SHARP_BOOK || 'pinnacle',
    softBooks: list(env.SOFT_BOOKS, 'onexbet,marathonbet'),

    minEdge: num(env.MIN_EDGE, 0.02),
    maxEdge: num(env.MAX_EDGE, 0.10),
    minMinutesToStart: num(env.MIN_MINUTES_TO_START, 10),
    lookaheadHours: num(env.LOOKAHEAD_HOURS, 12),
    maxStalenessSec: num(env.MAX_STALENESS_SEC, 300),
    maxOdds: num(env.MAX_ODDS, 5.0),
    minOdds: num(env.MIN_ODDS, 1.3),
    devigMethod: env.DEVIG_METHOD || 'power',

    scanIntervalMin: num(env.SCAN_INTERVAL_MIN, 5),
    settleIntervalMin: num(env.SETTLE_INTERVAL_MIN, 60),
    minQuotaRemaining: num(env.MIN_QUOTA_REMAINING, 200),
    // Napi kreditkeret (budapesti nap szerint). 0 = nincs korlát.
    dailyCreditBudget: num(env.DAILY_CREDIT_BUDGET, 0),

    // Automatikus ligalista (SPORTS=auto) és körforgás
    tickMinutes: num(env.TICK_MINUTES, 10),             // a cron gyakorisága (a napi keret elosztásához)
    discoverMaxCredits: num(env.DISCOVER_MAX_CREDITS, 150),
    discoverTop: num(env.DISCOVER_TOP, 25),
    discoverEveryDays: num(env.DISCOVER_EVERY_DAYS, 7),
    discoverGroups: list(env.DISCOVER_GROUPS, 'Soccer,Basketball,Ice Hockey,Handball,Tennis'),

    // Nyilvános (előfizetői) csatorna – üres PUBLIC_CHAT_ID = kikapcsolva
    publicChatId: env.PUBLIC_CHAT_ID || '',
    publicBotToken: env.PUBLIC_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || '',
    publicMinEdge: num(env.PUBLIC_MIN_EDGE, 0),         // ennél kisebb előnyt nem küld ki nyilvánosan (0 = mint MIN_EDGE)
    publicStake: {
      unitPct: num(env.PUBLIC_UNIT_PCT, 1),
      kellyFraction: num(env.PUBLIC_KELLY_FRACTION, 0.25),
      maxUnits: num(env.PUBLIC_MAX_UNITS, 3),
    },
    publicDailyAt: env.PUBLIC_DAILY_AT || '09:00',

    // Követő értesítések
    improveMinDelta: num(env.IMPROVE_MIN_DELTA, 0.02),   // ennyivel nagyobb előny kell a 🔔-hoz
    improveMax: num(env.IMPROVE_MAX, 2),                // kimenetelenként legfeljebb ennyi 🔔
  };
}
