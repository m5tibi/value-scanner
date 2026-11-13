// Liga-feltérképezés: mely The Odds API-sportkulcsoknál van meg EGYSZERRE a Pinnacle és legalább egy soft iroda,
// és hol mutat már egy olcsó (h2h) összevetés is pozitív előnyt. Ebből áll össze az automatikus ligalista (SPORTS=auto).
//
// Költség: sportkulcsonként 1 kredit (1 piac × ≤10 iroda = 1 régió), ha van meccs a 48 órás ablakban; az üres válasz ingyenes.
// A /sports lista ingyenes. Hetente egyszer fut magától (tick), vagy kézzel: node src/index.js --discover

import { scanEvents } from './scanner.js';

const DAY = 86_400_000;

/** A feltérképezendő sportkulcsok a /sports listából (outright/tornagyőztes piacok nélkül). */
export function candidateSports(sports, groups = ['Soccer', 'Basketball', 'Ice Hockey', 'Handball', 'Tennis']) {
  const want = new Set(groups.map((g) => g.toLowerCase()));
  return sports
    .filter((s) => s.active !== false && !s.has_outrights && want.has(String(s.group).toLowerCase()))
    .map((s) => ({ key: s.key, title: s.title, group: s.group }));
}

/** Egy sportkulcs eredménye a lekért meccsekből. */
export function summarizeSport(events, cfg) {
  const soft = new Set(cfg.softBooks);
  const softCounts = {};
  let withPinnacle = 0, comparable = 0;
  for (const ev of events) {
    const keys = new Set((ev.bookmakers ?? []).filter((b) => b.markets?.length).map((b) => b.key));
    const hasPin = keys.has(cfg.sharpBook);
    if (hasPin) withPinnacle++;
    const softs = [...keys].filter((k) => soft.has(k));
    for (const k of softs) softCounts[k] = (softCounts[k] ?? 0) + 1;
    if (hasPin && softs.length) comparable++;
  }
  // Az elavulás-szűrőt itt lazítjuk: a feltérképezés csak azt nézi, van-e eltérés az árakban.
  const { signals } = scanEvents(events, { ...cfg, maxStalenessSec: 3600, minMinutesToStart: 0 });
  return { events: events.length, withPinnacle, comparable, softCounts, positive: signals.length };
}

/**
 * Rangsor: elöl a pozitív előnyt mutató ligák (több pozitív = előrébb), azon belül az összevethető meccsek száma dönt.
 * Kimarad, ahol kevés az összevethető meccs, vagy a meccsek kevesebb mint felénél van Pinnacle + soft iroda
 * (pl. NCAA-kosár: sok meccs, kevés összevetés – a körforgásban csak a kreditet vinné).
 */
export function pickSports(results, { top = 25, minComparable = 2, minRatio = 0.5 } = {}) {
  return results
    .filter((r) => r.comparable >= minComparable && r.comparable / Math.max(1, r.events) >= minRatio)
    .sort((a, b) => (b.positive - a.positive) || (b.comparable - a.comparable))
    .slice(0, top)
    .map((r) => r.key);
}

export async function discoverOnce({ api, db, cfg, log, notify, budget, maxCredits = 150, groups, top = 25 }) {
  const sports = await api.getSports();
  const cands = candidateSports(sports, groups);
  log(`Feltérképezés: ${cands.length} sportkulcs (${[...new Set(cands.map((c) => c.group))].join(', ')}), max. ${maxCredits} kredit.`);
  const books = [cfg.sharpBook, ...cfg.softBooks].slice(0, 10);
  const results = [];
  let spent = 0;
  for (const c of cands) {
    if (spent + 1 > maxCredits) { log(`Feltérképezés: kreditkorlát (${maxCredits}) elérve, ${results.length}/${cands.length} kész.`); break; }
    if (api.remaining !== null && api.remaining < cfg.minQuotaRemaining) { log('Feltérképezés: kvóta alacsony, leállítva.'); break; }
    let events = [];
    try {
      events = await api.getOdds(c.key, { bookmakers: books, markets: ['h2h'], lookaheadHours: 48 });
    } catch (e) {
      log(`Feltérképezés hiba (${c.key}): ${e.message}`);
      continue;
    } finally {
      spent += api.lastCost ?? 0;
      budget?.add(api.lastCost ?? 0);
    }
    if (!events.length) continue;
    results.push({ ...c, ...summarizeSport(events, cfg) });
  }

  const picked = pickSports(results, { top });
  const at = new Date().toISOString();
  await db.setState('discover_result', JSON.stringify({ at, spent, results }));
  // Előzmények (4 hét): a szkenner a legutóbbi néhány feltérképezés UNIÓJÁT figyeli, így egy válogatott-szünet
  // vagy idényvégi hét nem törli ki a ligákat (a meccs nélküli liga lekérdezése ingyenes).
  const hist = JSON.parse((await db.getState('discover_history')) ?? '[]')
    .filter((h) => Date.now() - Date.parse(h.at) < 28 * DAY);
  hist.push({ at, results: results.map(({ key, title, group, events, comparable, positive }) => ({ key, title, group, events, comparable, positive })) });
  await db.setState('discover_history', JSON.stringify(hist));
  if (picked.length) await db.setState('auto_sports', picked.join(','));
  await db.setState('discover_at', at);

  const byKey = new Map(results.map((r) => [r.key, r]));
  log(`Feltérképezés kész: ${results.length} sportkulcsban volt meccs, ${spent} kredit. Kiválasztva (${picked.length}): ${picked.join(', ')}`);
  if (notify && picked.length) {
    const lines = picked.slice(0, 25).map((k) => {
      const r = byKey.get(k);
      return `• <code>${k}</code> — ${r.comparable}/${r.events} összevethető, ${r.positive} pozitív`;
    });
    await notify([`🗺 <b>Liga-feltérképezés kész</b> (${spent} kredit)`,
      `A heti legjobb ligák (a korábbi hetek ligái is a listán maradnak, a meccs nélküliek ingyenesek):`, ...lines].join('\n'));
  }
  return { results, picked, spent };
}

/** Az első feltérképezés (2026-11-06) választása – az előzmények bevezetésekor ez még nem volt elmentve. */
export const SEED_PICKS = {
  at: '2026-11-06T12:00:00Z',
  picked: ['soccer_fa_cup', 'soccer_sweden_superettan', 'soccer_argentina_primera_division', 'soccer_germany_bundesliga', 'soccer_usa_mls',
    'soccer_china_superleague', 'soccer_spain_la_liga', 'soccer_japan_j_league', 'basketball_nba', 'soccer_efl_champ', 'soccer_germany_liga3',
    'soccer_mexico_ligamx', 'soccer_france_ligue_two', 'soccer_italy_serie_a', 'soccer_korea_kleague1', 'soccer_sweden_allsvenskan',
    'soccer_russia_premier_league', 'soccer_italy_serie_b', 'soccer_brazil_serie_b', 'soccer_france_ligue_one', 'soccer_germany_bundesliga2',
    'soccer_poland_ekstraklasa', 'soccer_turkey_super_league', 'soccer_australia_aleague', 'soccer_epl', 'soccer_uefa_europa_league'],
};

/**
 * Az automatikus ligalista: a legutóbbi feltérképezések (keepDays napon belül) választásainak uniója,
 * a legfrissebb elöl. A régebbieknél is az aktuális rangsor-szabály dönt (pickSports), ha megvannak az adatok.
 */
export function unionPicks(history, { top = 25, keepDays = 21, maxTotal = 50, now = Date.now() } = {}) {
  const recent = history.filter((h) => now - Date.parse(h.at) < keepDays * DAY).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const out = [];
  for (const h of recent) {
    const picks = h.results?.length ? pickSports(h.results, { top }) : (h.picked ?? []);
    for (const k of picks) if (!out.includes(k)) out.push(k);
  }
  return out.slice(0, maxTotal);
}

/** Kell-e (újra) feltérképezni: még nem volt, vagy régebbi, mint everyDays. */
export async function discoveryDue(db, everyDays = 7) {
  const at = await db.getState('discover_at');
  return !at || Date.now() - Date.parse(at) > everyDays * DAY;
}

/**
 * A szkennelendő sportok egy körre, körforgással (a mutató az adatbázisban marad):
 * annyit ad vissza, amennyi a kör kreditkeretébe várhatóan belefér.
 */
export function rotate(list, pointer, count) {
  if (!list.length) return { batch: [], next: 0 };
  const n = Math.min(Math.max(1, count), list.length);
  const start = ((pointer % list.length) + list.length) % list.length;
  const batch = Array.from({ length: n }, (_, i) => list[(start + i) % list.length]);
  return { batch, next: (start + n) % list.length };
}
