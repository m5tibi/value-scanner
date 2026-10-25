import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isImprovement, formatLiveReminder, splitDue, improvedHeader } from '../src/alerts.js';
import { makeFollowUp } from '../src/sportfolio/followup.js';
import { describeSelection } from '../src/markets.js';

test('javulás: jobb odds ÉS legalább 2 százalékpont plusz előny kell', () => {
  const prev = { odds: 2.23, edge: 0.054, count: 0 };
  assert.ok(isImprovement(prev, { odds: 2.30, edge: 0.080 }));
  assert.ok(!isImprovement(prev, { odds: 2.30, edge: 0.060 }));      // előny alig nőtt (Pinnacle is mozdult)
  assert.ok(!isImprovement(prev, { odds: 2.20, edge: 0.090 }));      // odds nem jobb
  assert.ok(!isImprovement({ ...prev, count: 2 }, { odds: 2.5, edge: 0.2 })); // elérte a maximumot
  assert.ok(!isImprovement({ odds: null, edge: null }, { odds: 3, edge: 0.5 })); // régi sor, nincs adat
  assert.match(improvedHeader({ book: '1xBet', ...prev }, { book: '1xBet', odds: 2.3, edge: 0.08 }), /2\.23 \(5\.4%\) → <b>1xBet 2\.3<\/b>/);
});

test('emlékeztető: csak a kezdés után, ablakon belül esedékes', () => {
  const now = new Date('2026-10-25T14:05:00Z');
  const ms = [
    { startAt: '2026-10-25T14:00:00Z' }, // 5 perce kezdődött -> esedékes
    { startAt: '2026-10-25T14:30:00Z' }, // még nem
    { startAt: '2026-10-25T13:00:00Z' }, // 65 perce -> lejárt
  ];
  const { due, expired } = splitDue(ms, now, 20);
  assert.equal(due.length, 1);
  assert.equal(expired.length, 1);
});

test('emlékeztető szövege', () => {
  const txt = formatLiveReminder({
    home: 'Crystal Palace', away: 'Newcastle United', sport: 'soccer_epl', league: 'soccer_epl',
    startAt: '2026-10-25T14:00:00Z',
    items: [{ toBet: 'Crystal Palace ázsiai hendikep 0 (döntetlennél visszajár)', book: '1xBet', odds: 2.23, threshold: 2.16 }],
  });
  assert.match(txt, /Elkezdődött/);
  assert.match(txt, /<code>Crystal Palace<\/code> – <code>Newcastle United<\/code>/);
  assert.match(txt, /Foci · <code>soccer_epl<\/code> · kezdés 15:00/);
  assert.match(txt, /1xBet 2\.23 \(küszöb ≥ 2\.16\)/);
});

test('hendikep 0 érthetően', () => {
  assert.equal(describeSelection({ market: 'spreads', name: 'Crystal Palace', point: 0 }), 'Crystal Palace ázsiai hendikep 0 (döntetlennél visszajár)');
  assert.equal(describeSelection({ market: 'spreads', name: 'X', point: -1.5 }), 'X -1.5 (ázsiai hendikep)');
});

const sig = (odds, startAt = new Date('2026-10-25T14:00:00Z')) => ({
  home: 'Crystal Palace', away: 'Newcastle United', startAt, period: 'Regular time', sport: 'Soccer', league: 'England. Premier League',
  value: { book: '1xbet', odds },
});
const an = (edge) => ({ toBet: 'Crystal Palace ázsiai hendikep 0', edge, threshold: 2.05 });

test('Sportfolio-követés: új -> ismétlés -> javulás -> emlékeztető egyszer', () => {
  const f = makeFollowUp();
  assert.equal(f.decide(sig(2.235), an(0.095)).action, 'new');
  f.record(sig(2.235), an(0.095), 1);
  assert.equal(f.decide(sig(2.24), an(0.097)).action, 'repeat');
  const d = f.decide(sig(2.35), an(0.15));
  assert.equal(d.action, 'improved');
  f.record(sig(2.35), an(0.15), 2, 'improved');

  assert.equal(f.takeDue(new Date('2026-10-25T13:59:00Z')).due.length, 0);
  const { due } = f.takeDue(new Date('2026-10-25T14:01:00Z'));
  assert.equal(due.length, 1);
  assert.equal(due[0].items.length, 1);         // egy kimenetel, a legutóbbi árral
  assert.equal(due[0].items[0].odds, 2.35);
  assert.deepEqual(due[0].ids, [1, 2]);
  assert.equal(f.takeDue(new Date('2026-10-25T14:02:00Z')).due.length, 0); // nem ismétli
});

test('Sportfolio-követés: félidős jelzésnél a periódus is látszik, adatbázisból visszatölthető', () => {
  const f = makeFollowUp();
  f.load([{ msg_id: 7, home: 'A', away: 'B', start_at: new Date('2026-10-25T14:00:00Z'), period: '1st Half', sport: 'Basketball',
    league: 'L', value_book: 'Winlinebet', value_odds: '2.09', to_bet: 'A -5.5', edge: '0.09', threshold: '1.92' }]);
  assert.equal(f.decide({ home: 'A', away: 'B', startAt: new Date('2026-10-25T14:00:00Z'), period: '1st Half', value: { book: 'Winlinebet', odds: 2.1 } },
    { toBet: 'A -5.5', edge: 0.09 }).action, 'repeat');
  const { due } = f.takeDue(new Date('2026-10-25T14:03:00Z'));
  assert.match(due[0].items[0].toBet, /^A -5\.5 · /);
});
