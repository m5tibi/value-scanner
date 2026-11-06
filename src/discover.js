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

/** Rangsor: a pozitív előnyök száma erősen, az összevethető meccsek száma gyengébben számít. */
export function pickSports(results, { top = 25, minComparable = 2 } = {}) {
  return results
    .filter((r) => r.comparable >= minComparable)
    .sort((a, b) => (b.positive * 3 + b.comparable) - (a.positive * 3 + a.comparable))
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
      `A szkenner mostantól ezeket a ligákat figyeli felváltva:`, ...lines].join('\n'));
  }
  return { results, picked, spent };
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
