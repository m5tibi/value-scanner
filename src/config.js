// Konfiguráció környezeti változókból (.env-et a futtató környezet tölti be, pl. Render, vagy `node --env-file=.env`).

const list = (v, d) => (v ?? d).split(',').map((s) => s.trim()).filter(Boolean);
const num = (v, d) => (v === undefined || v === '' ? d : Number(String(v).split('#')[0].trim()));

export const GOAL_LEAGUES = [
  'soccer_australia_aleague', 'soccer_netherlands_eredivisie', 'soccer_germany_bundesliga', 'soccer_belgium_first_div',
  'soccer_switzerland_superleague', 'soccer_austria_bundesliga', 'soccer_norway_eliteserien', 'soccer_usa_mls',
].join(',');

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
    // Gólgazdag ligák (pl. ausztrál A-League): mindig a listán vannak, és náluk a gólszám-piacot is nézzük.
    // Az alapértelmezett lista a meccsenkénti gólátlag alapján (kb. 3 gól felett): A-League, Eredivisie, Bundesliga,
    // belga, svájci, osztrák, norvég élvonal, MLS. Meccs nélküli liga lekérdezése ingyenes.
    pinnedSports: list(env.PINNED_SPORTS, GOAL_LEAGUES),
    goalSports: list(env.GOAL_SPORTS, GOAL_LEAGUES),
    // Alternatív gólvonalak (pl. 5,5 felett = "6+ gól"): meccsenként külön lekérdezés (1 kredit / meccs), ritkítva.
    altTotalsSports: list(env.ALT_TOTALS_SPORTS, GOAL_LEAGUES),
    altTotalsMaxEvents: num(env.ALT_TOTALS_MAX_EVENTS, 3),     // körönként legfeljebb ennyi meccs
    altTotalsEveryMin: num(env.ALT_TOTALS_EVERY_MIN, 240),     // egy meccset legfeljebb ennyi percenként kérdezünk újra
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
    // Napi kreditkeret (budapesti nap szerint). 0 = nincs korlát; "auto" = a megmaradt havi keretből számolja (src/budget.js).
    // Kizárt ligák (tartósan negatív CLV) – ezeket a szkenner nem nézi, akkor sem, ha a feltérképezés kiválasztja
    blockedSports: list(env.BLOCKED_SPORTS, 'icehockey_liiga,icehockey_sweden_hockey_league,icehockey_sweden_allsvenskan'),
    // TippmixPro-oddsok (foci): a Pinnacle-hez mérve külön forrásként (ingyenes, nem fogyaszt kreditet)
    tmpEnabled: !['0', 'false', 'off'].includes(String(env.TMP_ENABLED ?? '1').trim().toLowerCase()),
    tmpMinEdge: num(env.TMP_MIN_EDGE, num(env.MIN_EDGE, 0.02)),
    tmpMaxMatches: num(env.TMP_MAX_MATCHES, 40),           // körönként legfeljebb ennyi meccs teljes piaca
    dailyCreditAuto: String(env.DAILY_CREDIT_BUDGET ?? '').trim().toLowerCase().startsWith('auto'),
    dailyCreditBudget: String(env.DAILY_CREDIT_BUDGET ?? '').trim().toLowerCase().startsWith('auto') ? 0 : num(env.DAILY_CREDIT_BUDGET, 0),
    creditOtherDaily: num(env.CREDIT_OTHER_DAILY, 175),     // a többi felhasználó (VIP Value Tipster) becsült napi fogyasztása
    dailyCreditMin: num(env.DAILY_CREDIT_MIN, 100),
    dailyCreditMax: num(env.DAILY_CREDIT_MAX, 1500),
    dailyCreditFallback: num(env.DAILY_CREDIT_FALLBACK, 450), // ha még nincs kvótaadat

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
    publicMinOdds: num(env.PUBLIC_MIN_ODDS, 1.5),       // nyilvánosan csak ennél nagyobb odds (nagy esélyes: kevés nyerés, gyorsan eltűnik)
    publicMaxOdds: num(env.PUBLIC_MAX_ODDS, 5),
    // Kihagyott odds-sáv a nyilvános csatornában ("tól-ig", a felső határ már nem tartozik bele); üres = nincs.
    // 2026-11-27: a 2,50–3,49 sáv CLV-je tartósan nulla körül (31 tipp, −0,4%).
    publicSkipOdds: (String(env.PUBLIC_SKIP_ODDS ?? '2.5-3.5').match(/^\s*([\d.]+)\s*-\s*([\d.]+)\s*$/) ?? []).slice(1).map(Number),
    publicStake: {
      unitPct: num(env.PUBLIC_UNIT_PCT, 1),
      kellyFraction: num(env.PUBLIC_KELLY_FRACTION, 0.25),
      maxUnits: num(env.PUBLIC_MAX_UNITS, 1),            // nyilvános tipp legfeljebb ennyi egység (2026-11-14: 3 -> 1)
      lowTierRe: env.PUBLIC_LOW_TIER_RE || undefined,     // alsóbb osztály / kupa: fél tét (alapértelmezés: public.js LOW_TIER_RE)
    },
    publicDailyAt: env.PUBLIC_DAILY_AT || '09:00',

    // Követő értesítések
    improveMinDelta: num(env.IMPROVE_MIN_DELTA, 0.02),   // ennyivel nagyobb előny kell a 🔔-hoz
    improveMax: num(env.IMPROVE_MAX, 2),                // kimenetelenként legfeljebb ennyi 🔔
  };
}
