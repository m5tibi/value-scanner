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
