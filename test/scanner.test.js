import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanEvents } from '../src/scanner.js';
import { loadConfig } from '../src/config.js';

const now = new Date('2026-10-23T12:00:00Z');
const fresh = '2026-10-23T11:59:00Z';
const stale = '2026-10-23T11:00:00Z';
const cfg = { ...loadConfig({}), softBooks: ['onexbet', 'marathonbet'] };

function ev({ start = '2026-10-23T15:00:00Z', pin, soft, softKey = 'onexbet', softUpdate = fresh, pinUpdate = fresh }) {
  return {
    id: 'e1', sport_key: 'soccer_epl', home_team: 'Home', away_team: 'Away', commence_time: start,
    bookmakers: [
      { key: 'pinnacle', markets: [{ key: 'totals', last_update: pinUpdate, outcomes: pin }] },
      { key: softKey, markets: [{ key: 'totals', last_update: softUpdate, outcomes: soft }] },
    ],
  };
}
const pin = [{ name: 'Over', point: 2.5, price: 2.10 }, { name: 'Under', point: 2.5, price: 1.80 }];

test('reális value-t jelez, helyes küszöb-oddsszal', () => {
  const { signals } = scanEvents([ev({ pin, soft: [{ name: 'Over', point: 2.5, price: 2.25 }, { name: 'Under', point: 2.5, price: 1.62 }] })], cfg, now);
  assert.equal(signals.length, 1);
  const s = signals[0];
  assert.equal(s.outcome_name, 'Over');
  assert.ok(s.edge > 0.02 && s.edge < 0.10, `edge=${s.edge}`);
  assert.ok(s.min_odds > s.fair_odds && s.min_odds < s.soft_odds);
});

test('nincs jelzés, ha nincs előny', () => {
  const { signals } = scanEvents([ev({ pin, soft: [{ name: 'Over', point: 2.5, price: 2.05 }, { name: 'Under', point: 2.5, price: 1.75 }] })], cfg, now);
  assert.equal(signals.length, 0);
});

test('10% feletti előny gyanús -> kiszűrve', () => {
  const { signals, rejected } = scanEvents([ev({ pin, soft: [{ name: 'Over', point: 2.5, price: 2.60 }, { name: 'Under', point: 2.5, price: 1.40 }] })], cfg, now);
  assert.equal(signals.length, 0);
  assert.equal(rejected.tul_nagy_elony, 1);
});

test('eltérő vonal (soft csak 3.0) nem párosul a Pinnacle 2.5-tel', () => {
  const { signals } = scanEvents([ev({ pin, soft: [{ name: 'Over', point: 3.0, price: 2.9 }, { name: 'Under', point: 3.0, price: 1.4 }] })], cfg, now);
  assert.equal(signals.length, 0);
});

test('elavult soft odds és kezdéshez túl közeli meccs kiszűrve', () => {
  const soft = [{ name: 'Over', point: 2.5, price: 2.25 }, { name: 'Under', point: 2.5, price: 1.62 }];
  assert.equal(scanEvents([ev({ pin, soft, softUpdate: stale })], cfg, now).signals.length, 0);
  const r = scanEvents([ev({ pin, soft, start: '2026-10-23T12:05:00Z' })], cfg, now);
  assert.equal(r.signals.length, 0);
  assert.equal(r.rejected.kezdeshez_tul_kozel, 1);
});

test('elavult Pinnacle esetén semmi, és nincs CLV-snapshot sem', () => {
  const soft = [{ name: 'Over', point: 2.5, price: 2.25 }, { name: 'Under', point: 2.5, price: 1.62 }];
  const r = scanEvents([ev({ pin, soft, pinUpdate: stale })], cfg, now);
  assert.equal(r.signals.length, 0);
  assert.equal(r.sharpSnapshots.length, 0);
});

test('nem figyelt iroda oddsa nem számít', () => {
  const soft = [{ name: 'Over', point: 2.5, price: 2.25 }, { name: 'Under', point: 2.5, price: 1.62 }];
  assert.equal(scanEvents([ev({ pin, soft, softKey: 'williamhill' })], cfg, now).signals.length, 0);
});

test('1X2 piacon a döntetlen is vizsgálható', () => {
  const e = {
    id: 'e2', sport_key: 'soccer_epl', home_team: 'H', away_team: 'A', commence_time: '2026-10-23T18:00:00Z',
    bookmakers: [
      { key: 'pinnacle', markets: [{ key: 'h2h', last_update: fresh, outcomes: [
        { name: 'H', price: 2.20 }, { name: 'Draw', price: 3.40 }, { name: 'A', price: 3.50 }] }] },
      { key: 'marathonbet', markets: [{ key: 'h2h', last_update: fresh, outcomes: [
        { name: 'H', price: 2.10 }, { name: 'Draw', price: 3.65 }, { name: 'A', price: 3.30 }] }] },
    ],
  };
  const { signals } = scanEvents([e], cfg, now);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].outcome_name, 'Draw');
  assert.equal(signals[0].soft_book, 'marathonbet');
});

import { groupOutcomes } from '../src/markets.js';
test('h2h: kétesélyes Pinnacle nem hasonlítható háromesélyes soft piachoz (Füchse–Kiel hiba)', async () => {
  const { scanEvents } = await import('../src/scanner.js');
  const now = new Date();
  const fresh = new Date(now - 30e3).toISOString();
  const start = new Date(now.getTime() + 20 * 3600e3).toISOString();
  const ev = { id: 'k1', sport_key: 'handball_germany_bundesliga', home_team: 'Füchse Berlin', away_team: 'THW Kiel', commence_time: start, bookmakers: [
    { key: 'pinnacle', last_update: fresh, markets: [{ key: 'h2h', last_update: fresh, outcomes: [{ name: 'Füchse Berlin', price: 1.55 }, { name: 'THW Kiel', price: 2.62 }] }] },
    { key: 'onexbet', last_update: fresh, markets: [{ key: 'h2h', last_update: fresh, outcomes: [{ name: 'Füchse Berlin', price: 1.73 }, { name: 'THW Kiel', price: 2.8 }, { name: 'Draw', price: 9.5 }] }] },
  ] };
  assert.deepEqual([...groupOutcomes(ev.bookmakers[0].markets[0], ev).keys()], ['h2h']);
  assert.deepEqual([...groupOutcomes(ev.bookmakers[1].markets[0], ev).keys()], ['h2h@3']);
  const cfg = { sharpBook: 'pinnacle', softBooks: ['onexbet'], minEdge: 0.02, maxEdge: 0.10, maxOdds: 5, minOdds: 1.3, minMinutesToStart: 10, maxStalenessSec: 300, devigMethod: 'power' };
  assert.equal(scanEvents([ev], cfg, now).signals.length, 0);
});

test('ugyanannak a piacnak két kimenetele egyszerre nem lehet jelzés', async () => {
  const { scanEvents } = await import('../src/scanner.js');
  const now = new Date();
  const fresh = new Date(now - 30e3).toISOString();
  const start = new Date(now.getTime() + 20 * 3600e3).toISOString();
  const ev = { id: 'x', sport_key: 'basketball_nba', home_team: 'A', away_team: 'B', commence_time: start, bookmakers: [
    { key: 'pinnacle', last_update: fresh, markets: [{ key: 'h2h', last_update: fresh, outcomes: [{ name: 'A', price: 1.95 }, { name: 'B', price: 1.95 }] }] },
    { key: 'onexbet', last_update: fresh, markets: [{ key: 'h2h', last_update: fresh, outcomes: [{ name: 'A', price: 2.08 }, { name: 'B', price: 2.08 }] }] },
  ] };
  const cfg = { sharpBook: 'pinnacle', softBooks: ['onexbet'], minEdge: 0.02, maxEdge: 0.10, maxOdds: 5, minOdds: 1.3, minMinutesToStart: 10, maxStalenessSec: 300, devigMethod: 'power' };
  const r = scanEvents([ev], cfg, now);
  assert.equal(r.signals.length, 0);
  assert.equal(r.rejected.mindket_oldal, 1);
});
