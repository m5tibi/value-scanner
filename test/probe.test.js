import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pinnapiFind, bookList, findSlug,
  pinnapiSportId, pinnapiEvents, findPinnapiEvent, pinnapiPrices,
  oddspapiSportId, tippmixSlugs, findOddspapiFixture, oddspapiPrices, matchPrice,
} from '../src/probe/providers.js';
import { makeProbe, fromSurebet } from '../src/probe/probe.js';
import { parseSignal } from '../src/sportfolio/parse.js';
import { parseOddsHub, analyzeOddsHub } from '../src/sportfolio/oddshub.js';

const ROKI = `New odds update on **Pinnacle**
**Hockey - Finland - Mestis**
Kiekko-Vantaa vs Roki
**30.10.2026 17:30**
1.833⬆️ (1.680) - 1.909⬇️ (2.100)
TippmixPRO
1.51 - **2.23**
💰 **Stake: 2.00u**
**🎯 EV: 108.99%**`;
const now = new Date('2026-10-30T13:50:00Z');
const sig = parseOddsHub(ROKI, now);
const a = analyzeOddsHub(sig, { now });

// A dokumentáció példái alapján felépített válaszok
const PIN_FIXTURES = { events: [
  { event_id: 111, home: 'Jokipojat', away: 'KeuPa', starts: '2026-10-30T16:30:00Z' },
  { event_id: 222, home: 'Kiekko-Vantaa', away: 'RoKi', starts: '2026-10-30T16:30:00Z', league_name: 'Finland - Mestis' },
] };
const PIN_LINES = { events: [{ event_id: 222, periods: { num_0: {
  money_line: { home: 1.833, away: 1.909 },
  totals: { '5.5': { points: 5.5, over: 1.9, under: 1.95 } },
  spreads: { '-1.5': { hdp: -1.5, home: 2.6, away: 1.5 } },
} } }] };

const OP_SPORTS = [{ sportId: 10, sportName: 'Soccer' }, { sportId: 15, sportName: 'Ice Hockey', slug: 'ice-hockey' }, { sportId: 11, sportName: 'Basketball' }];
const OP_BOOKS = [{ slug: 'pinnacle', bookmakerName: 'Pinnacle' }, { slug: 'bet365', bookmakerName: 'Bet365' }, { slug: 'tippmixpro', bookmakerName: 'TippmixPro' }, { slug: '1xbet', bookmakerName: '1xBet' }, { slug: 'vegashu', bookmakerName: 'Vegas.hu' }];
const OP_FIXTURES = [{ fixtureId: 'id1', participant1Name: 'Kiekko-Vantaa', participant2Name: 'RoKi Rovaniemi', startTime: '2026-10-30T16:30:00.000Z', tournamentName: 'Mestis' }];
const OP_ODDS = { fixtureId: 'id1', bookmakerOdds: {
  pinnacle: { markets: { 15101: { bookmakerMarketId: 'moneyline', outcomes: { 1: { players: { 0: { price: 1.833, bookmakerOutcomeId: 'home', active: true } } }, 2: { players: { 0: { price: 1.909, bookmakerOutcomeId: 'away', active: true } } } } } } },
  tippmixpro: { markets: { 15101: { bookmakerMarketId: 'ML', outcomes: { 1: { players: { 0: { price: 1.51, active: true } } }, 2: { players: { 0: { price: 2.23, active: true, changedAt: '2026-10-30T13:49:00Z' } } } } } } },
} };

test('pinnapi: sportág, meccs-keresés eltérő írásmóddal, ML-árak', () => {
  assert.equal(pinnapiSportId('Hockey'), 4);
  assert.equal(pinnapiSportId('Handball'), 10);
  const ev = findPinnapiEvent(pinnapiEvents(PIN_FIXTURES), sig);
  assert.equal(ev.event_id, 222);
  assert.deepEqual(pinnapiPrices(pinnapiEvents(PIN_LINES)[0], sig), [1.833, 1.909]);
  const tot = { ...sig, market: { type: 'totals', line: 5.5 } };
  assert.deepEqual(pinnapiPrices(pinnapiEvents(PIN_LINES)[0], tot), [1.9, 1.95]);
  assert.equal(pinnapiPrices(pinnapiEvents(PIN_LINES)[0], { ...sig, market: { type: 'totals', line: 6.5 } }), null);
});

test('OddsPapi: sportId, Tippmix-slug, fixture, ár-egyezés', () => {
  assert.equal(oddspapiSportId(OP_SPORTS, 'Hockey'), 15);
  assert.equal(oddspapiSportId(OP_SPORTS, 'Basketball'), 11);
  assert.equal(oddspapiSportId(OP_SPORTS, 'Football'), 10); // OddsPapi: "Soccer"
  assert.deepEqual(tippmixSlugs(OP_BOOKS), ['tippmixpro']);
  assert.equal(findOddspapiFixture(OP_FIXTURES, sig).fixtureId, 'id1');
  const tp = oddspapiPrices(OP_ODDS, 'tippmixpro');
  assert.equal(tp.length, 2);
  assert.equal(matchPrice(tp, 2.23).changedAt, '2026-10-30T13:49:00Z');
  assert.equal(matchPrice(tp, 2.40), null);
  assert.equal(oddspapiPrices(OP_ODDS, 'unibet'), null);
});

test('teljes folyamat álválaszokkal: mindkét szolgáltató, napi limit, DB-mentés', async () => {
  const state = new Map();
  const saved = [];
  const db = {
    getState: async (k) => state.get(k) ?? null,
    setState: async (k, v) => { state.set(k, v); },
    insertProbe: async (x) => { saved.push(x); },
  };
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const u = new URL(url);
    const body = u.pathname.endsWith('/fixtures') && u.host === 'pinnapi.com' ? PIN_FIXTURES
      : u.pathname.endsWith('/lines') ? PIN_LINES
      : u.pathname.endsWith('/sports') ? OP_SPORTS
      : u.pathname.endsWith('/bookmakers') ? OP_BOOKS
      : u.pathname.endsWith('/fixtures') ? OP_FIXTURES
      : u.pathname.endsWith('/odds') ? OP_ODDS : {};
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const logs = [];
  const probe = makeProbe({ env: { PINNAPI_KEY: 'p', ODDSPAPI_KEY: 'o', PROBE_PINNAPI_OH_DAILY: '1', PROBE_ODDSPAPI_OH_DAILY: '1' }, db, log: (...x) => logs.push(x.join(' ')), fetchImpl });
  // a szüneteket (sleep) itt nem várjuk ki: setTimeout gyorsítása
  const st = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...r) => st(fn, Math.min(ms, 1), ...r);
  try {
    probe.enqueue(sig, a, { channelId: 'c', msgId: 1 });
    probe.enqueue(sig, a, { channelId: 'c', msgId: 2 }); // a napi limit (1) miatt ez már nem kérdez le
    await new Promise((r) => st(r, 200));
  } finally { globalThis.setTimeout = st; }

  assert.equal(saved.length, 2);
  const pin = saved.find((x) => x.provider === 'pinnapi');
  const op = saved.find((x) => x.provider === 'oddspapi');
  assert.ok(pin.found && pin.pinMatch);
  assert.ok(op.found && op.pinMatch && op.softFound && op.softMatch);
  assert.deepEqual(op.bookmakers, ['pinnacle', 'tippmixpro']);
  assert.ok(urls.some((u) => u.includes('bookmakers=pinnacle,tippmixpro')));
  assert.ok(logs.some((l) => /Tippmix-slug: tippmixpro/.test(l)));
  assert.ok(pin.raw && op.raw); // az első nyers válaszok mentve
});

test('kulcs nélkül nincs teszt', () => {
  assert.equal(makeProbe({ env: {}, db: null, log() {} }), null);
});

test('Tippmix-slug a /bookmakers válasz többféle alakjából', () => {
  assert.deepEqual(tippmixSlugs({ pinnacle: { name: 'Pinnacle' }, tippmixpro: { name: 'TippmixPro' } }), ['tippmixpro']);
  assert.deepEqual(tippmixSlugs({ data: [{ slug: 'tmp', bookmakerName: 'Tippmix Pro' }] }), ['tmp']);
  assert.deepEqual(tippmixSlugs(['pinnacle', 'tippmix']), ['tippmix']);
  assert.deepEqual(tippmixSlugs([{ slug: 'bet365' }]), []);
});

test('irodanév -> OddsPapi-slug, ár keresése a pinnapi-eseményben', () => {
  const books = bookList(OP_BOOKS);
  assert.equal(findSlug(books, '1xbet'), '1xbet');
  assert.equal(findSlug(books, 'Bet365'), 'bet365');
  assert.equal(findSlug(books, 'Vegas.hu'), 'vegashu');
  assert.equal(findSlug(books, 'Avgline'), null);
  assert.equal(findSlug(books, 'Winlinebet'), null);
  assert.deepEqual(pinnapiFind(pinnapiEvents(PIN_LINES)[0], 1.5), [1.5]);   // a hendikep away-ára
  assert.equal(pinnapiFind(pinnapiEvents(PIN_LINES)[0], 5.5), null);        // a vonal értékét (points) nem tekinti árnak
});

test('Value NonStop-jelzés a tesztben: soft iroda (1xBet) és Pinnacle-ár keresése', async () => {
  const NONSTOP = `💰 New surebet found!
Profit: 4.15%
Sport: Hockey
League: Finland. Mestis
Event: Kiekko-Vantaa - RoKi [Full time with overtimes]
Start at : 30 Oct 16:30 UTC

1xbet:
▫️AH2(+1.5) → 1.5
▫️Stake: 43.4 $ Place Bet
Pinnacle:
▫️AH1(-1.5) → 2.6
▫️Stake: 56.6 $ Place Bet`;
  const sf = parseSignal(NONSTOP, now);
  const { sig: ps, a: pa } = fromSurebet(sf);
  assert.equal(ps.kind, 'sf');
  assert.deepEqual(ps.pin, [{ odds: 2.6 }]);
  assert.equal(pa.softOdds, 1.5);

  const OP_ODDS_SF = { bookmakerOdds: {
    pinnacle: { markets: { 1: { outcomes: { 1: { players: { 0: { price: 2.6, active: true } } } } } } },
    '1xbet': { markets: { 1: { outcomes: { 1: { players: { 0: { price: 1.5, active: true } } } } } } },
  } };
  const saved = [], urls = [];
  const db = { getState: async () => null, setState: async () => {}, insertProbe: async (x) => { saved.push(x); } };
  const fetchImpl = async (url) => {
    urls.push(url);
    const u = new URL(url);
    const body = u.host === 'pinnapi.com' ? (u.pathname.endsWith('/fixtures') ? PIN_FIXTURES : PIN_LINES)
      : u.pathname.endsWith('/sports') ? OP_SPORTS : u.pathname.endsWith('/bookmakers') ? OP_BOOKS
      : u.pathname.endsWith('/fixtures') ? OP_FIXTURES : OP_ODDS_SF;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const logs = [];
  const probe = makeProbe({ env: { PINNAPI_KEY: 'p', ODDSPAPI_KEY: 'o' }, db, log: (...x) => logs.push(x.join(' ')), fetchImpl });
  const st = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...r) => st(fn, Math.min(ms, 1), ...r);
  try { probe.enqueue(sf, {}, { channelId: 'c', msgId: 9 }, 'sf'); await new Promise((r) => st(r, 200)); }
  finally { globalThis.setTimeout = st; }

  const pin = saved.find((x) => x.provider === 'pinnapi');
  const op = saved.find((x) => x.provider === 'oddspapi');
  assert.ok(pin.found && pin.pinMatch);              // 2.6 megvan a pinnapi-eseményben (hendikep)
  assert.ok(op.softFound && op.softMatch);           // 1xBet 1.5 megvan az OddsPapi-ban
  assert.ok(urls.some((u) => u.includes('bookmakers=pinnacle,1xbet')));
  assert.ok(logs.some((l) => /magyar irodák: .*Vegas\.hu/.test(l)));
});
