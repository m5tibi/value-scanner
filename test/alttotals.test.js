// Alternatív gólvonalak (alternate_totals, pl. 5,5 felett = "6+ gól") beolvasztása és szkennelése.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAltTotals } from '../src/markets.js';
import { scanEvents } from '../src/scanner.js';
import { settleSignal } from '../src/settle.js';

const fresh = new Date(Date.now() - 30e3).toISOString();
const start = new Date(Date.now() + 5 * 3600e3).toISOString();
const base = {
  id: 'au1', sport_key: 'soccer_australia_aleague', home_team: 'Western Sydney Wanderers', away_team: 'Adelaide United', commence_time: start,
  bookmakers: [
    { key: 'pinnacle', last_update: fresh, markets: [{ key: 'totals', last_update: fresh, outcomes: [{ name: 'Over', point: 3.25, price: 1.95 }, { name: 'Under', point: 3.25, price: 1.93 }] }] },
    { key: 'onexbet', last_update: fresh, markets: [{ key: 'totals', last_update: fresh, outcomes: [{ name: 'Over', point: 3.25, price: 1.9 }, { name: 'Under', point: 3.25, price: 1.9 }] }] },
  ],
};
const alt = { id: 'au1', bookmakers: [
  { key: 'pinnacle', last_update: fresh, markets: [{ key: 'alternate_totals', last_update: fresh, outcomes: [
    { name: 'Over', point: 5.5, price: 4.6 }, { name: 'Under', point: 5.5, price: 1.24 },
    { name: 'Over', point: 3.25, price: 9.99 }, { name: 'Under', point: 3.25, price: 1.01 }, // a fő vonallal ütköző: a fő vonal marad
  ] }] },
  { key: 'onexbet', last_update: fresh, markets: [{ key: 'alternate_totals', last_update: fresh, outcomes: [{ name: 'Over', point: 5.5, price: 5.4 }, { name: 'Under', point: 5.5, price: 1.15 }] }] },
] };

test('mergeAltTotals: az alternatív vonal bekerül a totals piacba, a fő vonal elsőbbséget élvez, a bemenet változatlan', () => {
  const merged = mergeAltTotals(base, alt);
  const pin = merged.bookmakers.find((b) => b.key === 'pinnacle').markets.find((m) => m.key === 'totals');
  assert.equal(pin.outcomes.filter((o) => o.point === 5.5).length, 2);
  assert.equal(pin.outcomes.find((o) => o.point === 3.25 && o.name === 'Over').price, 1.95);
  assert.equal(base.bookmakers[0].markets[0].outcomes.length, 2, 'a bemenet nem módosulhat');
  assert.deepEqual(mergeAltTotals(base, null).bookmakers.map((b) => b.key), ['pinnacle', 'onexbet']);
});

test('6+ gól (Over 5,5): a beolvasztott vonalon a szkenner jelzést ad, és az elszámolás 5-2-nél nyertes', () => {
  const merged = mergeAltTotals(base, alt);
  const { signals } = scanEvents([merged], { sharpBook: 'pinnacle', softBooks: ['onexbet'], minEdge: 0.02, maxEdge: 0.2,
    minMinutesToStart: 10, maxStalenessSec: 300, minOdds: 1.3, maxOdds: 6, devigMethod: 'power' });
  const six = signals.find((s) => s.market === 'totals' && Number(s.point) === 5.5 && s.outcome_name === 'Over');
  assert.ok(six, 'kell jelzés az Over 5,5-re');
  assert.ok(six.edge > 0.02);
  const r = settleSignal({ ...six, soft_odds: 5.4 }, 5, 2);
  assert.equal(settleSignal({ ...six, soft_odds: 5.4 }, 4, 1).result, 'vesztett');
  assert.equal(r.result, 'nyert');
});
