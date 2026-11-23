import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRecords, topics } from '../src/tippmix/client.js';

test('TippmixPro: valódi ligalista-rekordokból meccs + 1X2 odds', () => {
  const recs = JSON.parse(readFileSync(new URL('./fixtures-tmp-league.json', import.meta.url)));
  const [m] = parseRecords(recs);
  assert.equal(m.name, 'Charlton - Lincoln City');
  assert.equal(m.markets[0].name, '1X2 - Rendes játékidő');
  assert.equal(m.markets[0].outcomes.length, 3);
  assert.ok(m.markets[0].outcomes.every((o) => o.odds > 1));
});

test('TippmixPro: témák', () => {
  assert.equal(topics.tournaments(1, 77), '/sports/2901/hu/tournaments/1/77');
  assert.equal(topics.matchOdds('1'), '/sports/2901/hu/1/match-odds/market-group/NEPSZERU');
});

import { toBookmaker, pairEvents, makeTmpFeed, countryFor } from '../src/tippmix/feed.js';
import { scanEvents } from '../src/scanner.js';

const league = JSON.parse(readFileSync(new URL('./fixtures-tmp-league.json', import.meta.url)));
const tmpMatch = league.find((r) => r._type === 'MATCH');
const ev = (over = {}) => ({
  id: 'e1', sport_key: 'soccer_efl_champ', home_team: 'Charlton Athletic', away_team: 'Lincoln City',
  commence_time: new Date(tmpMatch.startTime).toISOString(),
  bookmakers: [{ key: 'pinnacle', last_update: new Date(tmpMatch.startTime - 3600e3).toISOString(), markets: [
    { key: 'h2h', outcomes: [{ name: 'Charlton Athletic', price: 2.9 }, { name: 'Draw', price: 3.3 }, { name: 'Lincoln City', price: 2.6 }] },
    { key: 'totals', outcomes: [{ name: 'Over', point: 2.5, price: 2.05 }, { name: 'Under', point: 2.5, price: 1.85 }] },
  ] }],
  ...over,
});

test('TippmixPro: ország a sport_key-ből', () => {
  assert.equal(countryFor('soccer_efl_champ').name, 'Anglia');
  assert.equal(countryFor('soccer_germany_bundesliga2').name, 'Németország');
  assert.equal(countryFor('soccer_uefa_champs_league').intl, true);
  assert.equal(countryFor('basketball_nba'), null);
});

test('TippmixPro: párosítás csapatnév + idő alapján (Charlton – Charlton Athletic)', () => {
  const [m] = parseRecords(league);
  assert.equal(pairEvents([ev()], [m]).length, 1);
  assert.equal(pairEvents([ev({ commence_time: new Date(tmpMatch.startTime + 3 * 3600e3).toISOString() })], [m]).length, 0);
  assert.equal(pairEvents([ev({ home_team: 'Lincoln City', away_team: 'Charlton Athletic' })], [m]).length, 0, 'fordított sorrend nem');
});

test('TippmixPro: piacok átfordítása (1X2 → h2h, gólszám → totals, DNB → spreads@0)', () => {
  const tm = { name: 'Charlton - Lincoln City', start: new Date(tmpMatch.startTime), markets: [
    { type: '1X2', part: 'Rendes játékidő', outcomes: [{ name: 'Charlton', odds: 2.68 }, { name: 'Döntetlen', odds: 3.25 }, { name: 'Lincoln City', odds: 2.59 }] },
    { type: 'Gólszám', part: 'Rendes játékidő', outcomes: [{ name: 'Több, mint 2.5', line: 2.5, kind: 'Total Score Over', odds: 2.2 }, { name: 'Kevesebb, mint 2.5', line: 2.5, kind: 'Total Score Under', odds: 1.7 }] },
    { type: 'gólszám', part: 'Rendes játékidő', outcomes: [{ name: 'Charlton: Több, mint 1.5', line: 1.5, kind: 'Team Score Over/Under', odds: 2.4 }] },
    { type: 'Gólszám', part: '1. félidő', outcomes: [{ name: 'Több, mint 0.5', line: 0.5, kind: 'Total Score Over', odds: 1.4 }] },
    { type: 'Döntetlennél a tét visszajár', part: 'Rendes játékidő', outcomes: [{ name: 'Charlton', odds: 1.95 }, { name: 'Lincoln City', odds: 1.85 }] },
  ] };
  const bm = toBookmaker(tm, ev(), new Date(tmpMatch.startTime - 3600e3));
  const h2h = bm.markets.find((m) => m.key === 'h2h');
  assert.deepEqual(h2h.outcomes.map((o) => o.name), ['Charlton Athletic', 'Draw', 'Lincoln City']);
  const tot = bm.markets.find((m) => m.key === 'totals');
  assert.deepEqual(tot.outcomes, [{ name: 'Over', point: 2.5, price: 2.2 }, { name: 'Under', point: 2.5, price: 1.7 }], 'csapat- és félidős gólszám nem');
  assert.deepEqual(bm.markets.find((m) => m.key === 'spreads').outcomes.map((o) => o.point), [0, 0]);

  // A szkenner a "tippmixpro" irodát önálló lágy irodaként kezeli: 2.20 a fair ~2.1 felett value
  const e = { ...ev(), bookmakers: [...ev().bookmakers, bm] };
  const r = scanEvents([e], { sharpBook: 'pinnacle', softBooks: ['tippmixpro'], minEdge: 0.02, maxEdge: 0.3, minOdds: 1.3, maxOdds: 5,
    maxStalenessSec: 600, minMinutesToStart: 0, devigMethod: 'power' }, new Date(tmpMatch.startTime - 3600e3));
  const over = r.signals.find((s) => s.market === 'totals' && s.outcome_name === 'Over');
  assert.ok(over, 'Over 2.5 @2.20 value');
  assert.equal(over.soft_book, 'tippmixpro');
});

test('TippmixPro-feed: ligakeresés az országlistából, gyorsítótár, meccs-dúsítás (kamu kapcsolattal)', async () => {
  const state = new Map();
  const db = { getState: async (k) => state.get(k) ?? null, setState: async (k, v) => { state.set(k, v); } };
  const calls = [];
  const fake = { dump: async (topic) => {
    calls.push(topic);
    if (topic === '/sports/2901/hu/tournaments/1/77') return [{ _type: 'TOURNAMENT', id: 'T1', name: 'Angol Liga bajnokság 2026/2027', venueName: 'Anglia', numberOfUpcomingMatches: 24 }];
    if (/tournaments\/1\/\d+$/.test(topic)) return [];
    if (topic.includes('tournament-aggregator')) return league;
    if (topic.includes('match-odds')) return league;
    return [];
  }, close() {} };
  const feed = makeTmpFeed({ db, connect: async () => fake });
  const now = new Date(tmpMatch.startTime - 3600e3);
  const r = await feed.enrich('soccer_efl_champ', [ev()], now);
  assert.equal(r.paired, 1);
  assert.ok(r.events[0].bookmakers.some((b) => b.key === 'tippmixpro'));
  assert.equal(JSON.parse(state.get('tmp_league_map')).soccer_efl_champ.tid, 'T1');
  calls.length = 0;
  await feed.enrich('soccer_efl_champ', [ev()], now); // második kör: nincs újra ország- és ligakeresés
  assert.ok(!calls.some((t) => /tournaments\/1\//.test(t)));
  assert.equal((await feed.enrich('basketball_nba', [ev()], now)).paired, 0);
});
