// TippmixPro-oddsok beillesztése a szkenner eseményeibe, egy "tippmixpro" nevű lágy irodaként.
// Folyamat ligánként: ország (venue) → bajnokságok → a Pinnacle-meccsekkel legjobban egyező bajnokság (gyorsítótárazva)
// → meccspárosítás név + kezdési idő alapján → a párosított meccsek teljes piaca (1X2, gólszám, döntetlennél visszajár).
import { connectTmp, topics, parseRecords } from './client.js';
import { matchScore } from '../sportfolio/confirm.js';

export const TMP_BOOK = 'tippmixpro';

// The Odds API sport_key (soccer_<ország>_...) → a TippmixPro országneve (venueName)
const COUNTRY = [
  [/^soccer_(epl|efl|england|fa_cup)/, 'Anglia'], [/^soccer_germany/, 'Németország'], [/^soccer_spain/, 'Spanyolország'],
  [/^soccer_italy/, 'Olaszország'], [/^soccer_france/, 'Franciaország'], [/^soccer_netherlands/, 'Hollandia'],
  [/^soccer_portugal/, 'Portugália'], [/^soccer_belgium/, 'Belgium'], [/^soccer_switzerland/, 'Svájc'],
  [/^soccer_austria/, 'Ausztria'], [/^soccer_norway/, 'Norvégia'], [/^soccer_sweden/, 'Svédország'],
  [/^soccer_denmark/, 'Dánia'], [/^soccer_finland/, 'Finnország'], [/^soccer_scotland|^soccer_spl/, 'Skócia'],
  [/^soccer_turkey/, 'Törökország'], [/^soccer_greece/, 'Görögország'], [/^soccer_poland/, 'Lengyelország'],
  [/^soccer_brazil/, 'Brazília'], [/^soccer_argentina/, 'Argentína'], [/^soccer_usa/, 'USA'], [/^soccer_mexico/, 'Mexikó'],
  [/^soccer_australia/, 'Ausztrália'], [/^soccer_japan/, 'Japán'], [/^soccer_korea/, 'Dél-Korea'], [/^soccer_china/, 'Kína'],
  [/^soccer_russia/, 'Oroszország'], [/^soccer_czech/, 'Csehország'], [/^soccer_hungary/, 'Magyarország'],
  [/^soccer_(uefa|fifa)/, null], // nemzetközi: a venue-névből keressük (Nemzetközi / Európa / Világ)
];
const INTL = /nemzetk|európa|vil[aá]g|nemzet/i;

export function countryFor(sportKey) {
  for (const [re, name] of COUNTRY) if (re.test(sportKey)) return { name, intl: name === null };
  return null;
}

const toMatch = (m) => { const [home, away] = String(m.name).split(' - '); return { home, away, startAt: m.start }; };
const evMatch = (e) => ({ home: e.home_team, away: e.away_team, startAt: new Date(e.commence_time) });

/** A TippmixPro-meccs piacai The Odds API "bookmaker" formában, az Odds API-esemény csapatneveire fordítva. */
export function toBookmaker(tm, ev, now = new Date()) {
  const { home, away } = toMatch(tm);
  const nameOf = (n) => (n === home ? ev.home_team : n === away ? ev.away_team : null);
  const markets = [];
  const reg = (m) => m.part === 'Rendes játékidő';
  const x12 = tm.markets.find((m) => m.type === '1X2' && reg(m));
  if (x12) {
    const outs = x12.outcomes.filter((o) => o.odds > 1).map((o) => ({ name: o.name === 'Döntetlen' ? 'Draw' : nameOf(o.name), price: o.odds }));
    if (outs.length === 3 && outs.every((o) => o.name)) markets.push({ key: 'h2h', outcomes: outs });
  }
  const tot = [];
  for (const m of tm.markets.filter((x) => x.type === 'Gólszám' && reg(x))) {
    for (const o of m.outcomes) {
      if (!(o.odds > 1) || o.line == null) continue;
      if (o.kind === 'Total Score Over') tot.push({ name: 'Over', point: o.line, price: o.odds });
      else if (o.kind === 'Total Score Under') tot.push({ name: 'Under', point: o.line, price: o.odds });
    }
  }
  if (tot.length) markets.push({ key: 'totals', outcomes: tot });
  const dnb = tm.markets.find((m) => m.type === 'Döntetlennél a tét visszajár' && reg(m));
  if (dnb) {
    const outs = dnb.outcomes.filter((o) => o.odds > 1).map((o) => ({ name: nameOf(o.name), point: 0, price: o.odds }));
    if (outs.length === 2 && outs.every((o) => o.name)) markets.push({ key: 'spreads', outcomes: outs });
  }
  const last = now.toISOString();
  return { key: TMP_BOOK, title: 'TippmixPro', last_update: last, markets: markets.map((m) => ({ ...m, last_update: last })) };
}

/** Odds API-események ↔ TippmixPro-meccsek párosítása (mindkét csapat + kezdési idő). Fordított sorrendet nem fogad el. */
export function pairEvents(events, tmpMatches) {
  const out = [];
  for (const ev of events) {
    let best = null, bestScore = 0;
    for (const tm of tmpMatches) {
      const sc = matchScore(toMatch(tm), evMatch(ev), 20);
      if (sc > bestScore) { best = tm; bestScore = sc; }
    }
    if (best) out.push({ ev, tm: best });
  }
  return out;
}

/**
 * Egy szkennelési körre szóló TippmixPro-kapcsolat (lustán nyit, a kör végén zárni kell).
 * db: getState/setState a gyorsítótárhoz.
 */
export function makeTmpFeed({ db, log = () => {}, maxMatches = 40, connect = connectTmp }) {
  let conn = null, matchesUsed = 0;
  const client = async () => (conn ??= await connect({ log }));

  async function venues() {
    const cached = JSON.parse((await db.getState('tmp_venues')) ?? 'null');
    if (cached && Date.now() - cached.at < 7 * 86400e3) return cached.venues;
    const c = await client();
    const found = {};
    const ids = Array.from({ length: 350 }, (_, i) => i + 1);
    for (let i = 0; i < ids.length; i += 10) {
      const batch = await Promise.all(ids.slice(i, i + 10).map((v) => c.dump(topics.tournaments(1, v)).catch(() => [])));
      batch.forEach((recs, j) => {
        const t = recs.find((r) => r._type === 'TOURNAMENT' && r.venueName);
        if (t) found[t.venueName] = String(ids[i + j]);
      });
    }
    log(`TippmixPro: ${Object.keys(found).length} ország feltérképezve.`);
    if (Object.keys(found).length) await db.setState('tmp_venues', JSON.stringify({ at: Date.now(), venues: found }));
    return found;
  }

  /** A ligához tartozó TippmixPro-bajnokság meccsei (gyorsítótárazott bajnokság-párosítással). */
  async function leagueMatches(sportKey, events) {
    const map = JSON.parse((await db.getState('tmp_league_map')) ?? '{}');
    const hit = map[sportKey];
    const c = await client();
    if (hit && Date.now() - hit.at < (hit.tid ? 3 : 1) * 86400e3) {
      if (!hit.tid) return [];
      return parseRecords(await c.dump(topics.leagueMatches(hit.tid)));
    }
    const country = countryFor(sportKey);
    if (!country) return [];
    const v = await venues();
    const venueIds = Object.entries(v).filter(([name]) => (country.intl ? INTL.test(name) : name === country.name)).map(([, id]) => id);
    let best = { tid: null, n: 0, matches: [] };
    for (const vid of venueIds) {
      const tours = (await c.dump(topics.tournaments(1, vid))).filter((r) => r._type === 'TOURNAMENT' && (r.numberOfUpcomingMatches ?? 1) > 0);
      for (const t of tours) {
        const ms = parseRecords(await c.dump(topics.leagueMatches(t.id)));
        const n = pairEvents(events, ms).length;
        if (n > best.n) best = { tid: t.id, n, matches: ms, name: t.name };
      }
    }
    const ok = best.n >= Math.min(2, events.length);
    map[sportKey] = { tid: ok ? best.tid : null, name: ok ? best.name : null, at: Date.now() };
    await db.setState('tmp_league_map', JSON.stringify(map));
    log(`TippmixPro: ${sportKey} → ${ok ? `${best.name} (${best.n} meccs egyezik)` : 'nincs egyező bajnokság'}`);
    return ok ? best.matches : [];
  }

  return {
    /** Az eseményekhez hozzáadja a TippmixPro "irodát", ahol van párja. Visszaadja az új eseménylistát és a párosítások számát. */
    async enrich(sportKey, events, now = new Date()) {
      if (!/^soccer_/.test(sportKey) || !events?.length) return { events, paired: 0 };
      const upcoming = events.filter((e) => Date.parse(e.commence_time) > now.getTime());
      const ms = await leagueMatches(sportKey, upcoming);
      if (!ms.length) return { events, paired: 0 };
      const pairs = pairEvents(upcoming, ms);
      const c = await client();
      const byId = new Map();
      for (const { ev, tm } of pairs) {
        if (matchesUsed >= maxMatches) break;
        matchesUsed++;
        const [full] = parseRecords(await c.dump(topics.matchOdds(tm.id)).catch(() => []));
        const bm = toBookmaker(full ?? tm, ev, now);
        if (bm.markets.length) byId.set(ev.id, { ...ev, bookmakers: [...(ev.bookmakers ?? []), bm] });
      }
      return { events: events.map((e) => byId.get(e.id) ?? e), paired: byId.size };
    },
    close() { conn?.close(); conn = null; },
  };
}
