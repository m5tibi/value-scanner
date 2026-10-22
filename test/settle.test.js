import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleSignal, parseScores } from '../src/settle.js';

const base = { home_team: 'A', away_team: 'B', soft_odds: 2.0, sport_key: 'soccer_epl' };

test('h2h nyert / vesztett / döntetlen focin', () => {
  assert.deepEqual(settleSignal({ ...base, market: 'h2h', outcome_name: 'A' }, 2, 1), { result: 'nyert', profit: 1 });
  assert.deepEqual(settleSignal({ ...base, market: 'h2h', outcome_name: 'A' }, 1, 1), { result: 'vesztett', profit: -1 });
  assert.deepEqual(settleSignal({ ...base, market: 'h2h', outcome_name: 'Draw' }, 1, 1), { result: 'nyert', profit: 1 });
});

test('totals: egész vonal visszajár, fél vonal eldől', () => {
  assert.equal(settleSignal({ ...base, market: 'totals', outcome_name: 'Under', point: 3.0 }, 2, 1).result, 'visszajár');
  assert.equal(settleSignal({ ...base, market: 'totals', outcome_name: 'Over', point: 2.5 }, 2, 1).result, 'nyert');
  assert.equal(settleSignal({ ...base, market: 'totals', outcome_name: 'Under', point: 2.5 }, 2, 1).result, 'vesztett');
});

test('totals negyedvonal: Over 2.25 két góllal -> fél vereség, Over 2.75 három góllal -> fél nyerés', () => {
  assert.deepEqual(settleSignal({ ...base, market: 'totals', outcome_name: 'Over', point: 2.25 }, 1, 1),
    { result: 'fel_vesztett', profit: -0.5 });
  assert.deepEqual(settleSignal({ ...base, market: 'totals', outcome_name: 'Over', point: 2.75 }, 2, 1),
    { result: 'fel_nyert', profit: 0.5 });
});

test('spreads: Lille +2.75, 3-0 vereség -> fél vereség (Arsenal–Lille eset)', () => {
  const s = { ...base, home_team: 'Arsenal', away_team: 'Lille', soft_odds: 1.603, market: 'spreads', outcome_name: 'Lille', point: 2.75 };
  assert.deepEqual(settleSignal(s, 3, 0), { result: 'fel_vesztett', profit: -0.5 });
});

test('spreads: Virtus +9, 9 pontos vereség -> visszajár (Hapoel–Virtus eset)', () => {
  const s = { ...base, sport_key: 'basketball_euroleague', home_team: 'Hapoel', away_team: 'Virtus', soft_odds: 1.999, market: 'spreads', outcome_name: 'Virtus', point: 9 };
  assert.equal(settleSignal(s, 90, 81).result, 'visszajár');
});

test('spreads: hazai -5, 89-80 -> nyert (Efes–Besiktas eset)', () => {
  const s = { ...base, sport_key: 'basketball_euroleague', home_team: 'Efes', away_team: 'Besiktas', soft_odds: 2.087, market: 'spreads', outcome_name: 'Efes', point: -5 };
  assert.deepEqual(settleSignal(s, 89, 80), { result: 'nyert', profit: 1.087 });
});

test('parseScores', () => {
  const g = { completed: true, home_team: 'A', away_team: 'B', scores: [{ name: 'A', score: '3' }, { name: 'B', score: '1' }] };
  assert.deepEqual(parseScores(g), { home: 3, away: 1 });
  assert.equal(parseScores({ ...g, completed: false }), null);
});
