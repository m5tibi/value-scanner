import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateSports, summarizeSport, pickSports, rotate } from '../src/discover.js';

const cfg = {
  sharpBook: 'pinnacle', softBooks: ['onexbet', 'marathonbet'], markets: ['h2h'],
  minEdge: 0.02, maxEdge: 0.10, minMinutesToStart: 10, maxStalenessSec: 300, maxOdds: 5, minOdds: 1.3, devigMethod: 'power',
};
const fresh = new Date().toISOString();
const start = new Date(Date.now() + 6 * 3600e3).toISOString();
const ev = (id, pin, soft, withSoft = true) => ({
  id, sport_key: 'soccer_x', home_team: `H${id}`, away_team: `A${id}`, commence_time: start,
  bookmakers: [
    pin && { key: 'pinnacle', last_update: fresh, markets: [{ key: 'h2h', last_update: fresh, outcomes: [
      { name: `H${id}`, price: pin[0] }, { name: `A${id}`, price: pin[1] }, { name: 'Draw', price: pin[2] }] }] },
    withSoft && { key: 'onexbet', last_update: fresh, markets: [{ key: 'h2h', last_update: fresh, outcomes: [
      { name: `H${id}`, price: soft[0] }, { name: `A${id}`, price: soft[1] }, { name: 'Draw', price: soft[2] }] }] },
  ].filter(Boolean),
});

test('jelöltek: csak a kért sportcsoportok, tornagyőztes-piac nélkül', () => {
  const c = candidateSports([
    { key: 'soccer_epl', group: 'Soccer', active: true, has_outrights: false },
    { key: 'soccer_epl_winner', group: 'Soccer', active: true, has_outrights: true },
    { key: 'icehockey_sweden_hockey_league', group: 'Ice Hockey', active: true, has_outrights: false },
    { key: 'cricket_ipl', group: 'Cricket', active: true, has_outrights: false },
  ]);
  assert.deepEqual(c.map((x) => x.key), ['soccer_epl', 'icehockey_sweden_hockey_league']);
});

test('összesítés: Pinnacle + soft együtt = összevethető; pozitív előny számolva', () => {
  const r = summarizeSport([
    ev(1, [2.0, 3.8, 3.5], [2.25, 3.4, 3.2]),   // a hazai 2.25 a Pinnacle 2.0-hoz képest value
    ev(2, [2.0, 3.8, 3.5], [1.95, 3.6, 3.3]),   // nincs value
    ev(3, null, [2.0, 3.0, 3.0]),               // nincs Pinnacle
  ], cfg);
  assert.equal(r.events, 3);
  assert.equal(r.withPinnacle, 2);
  assert.equal(r.comparable, 2);
  assert.equal(r.softCounts.onexbet, 3);
  assert.ok(r.positive >= 1);
});

test('rangsor: elöl a pozitív előny, a kevés vagy ritka összevetés kiesik (NCAA-eset)', () => {
  const picked = pickSports([
    { key: 'mls', events: 15, comparable: 15, positive: 0 },
    { key: 'superettan', events: 8, comparable: 8, positive: 4 },
    { key: 'bundesliga', events: 6, comparable: 6, positive: 3 },
    { key: 'ncaab', events: 59, comparable: 16, positive: 0 },
    { key: 'tiny', events: 1, comparable: 1, positive: 5 },
  ], { top: 10 });
  assert.deepEqual(picked, ['superettan', 'bundesliga', 'mls']);
});

test('körforgás: folytatja, ahol abbahagyta, és körbeér', () => {
  assert.deepEqual(rotate(['a', 'b', 'c', 'd'], 3, 4).batch, ['d', 'a', 'b', 'c']);
  assert.deepEqual(rotate(['a', 'b', 'c'], 1, 2), { batch: ['b', 'c'], next: 0 });
  assert.deepEqual(rotate([], 5, 3), { batch: [], next: 0 });
});
