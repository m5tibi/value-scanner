import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPublicSignal, formatDailyResults, publicStake, yesterdayRange, leagueName, sportEmoji } from '../src/public.js';

const sig = {
  sport_key: 'soccer_sweden_superettan', home_team: 'Örgryte', away_team: 'Brage', commence_time: new Date(Date.now() + 125 * 60e3).toISOString(),
  market: 'totals', outcome_name: 'Over', point: 2.5, soft_book: 'onexbet', soft_odds: 2.12, fair_odds: 2.073, fair_prob: 1 / 2.073, edge: 0.023, min_odds: 2.11,
};

test('előfizetői jelzés: arculat, másolható nevek, küszöb, tét egységben, iroda NÉLKÜL', () => {
  const t = formatPublicSignal(sig, { id: 42, titles: { soccer_sweden_superettan: 'Superettan' }, stake: { unitPct: 1 } });
  assert.match(t, /💎 <b>Mondom a Tutit! · Value<\/b> · #42/);
  assert.match(t, /⚽ Foci · Superettan/);
  assert.match(t, /<code>Örgryte<\/code> – <code>Brage<\/code>/);
  assert.match(t, /2 óra 5 perc múlva|2 óra 4 perc múlva/);
  assert.match(t, /Odds most: <b>2\.12<\/b> · fair: 2\.07 · előny: <b>\+2,3%<\/b>/);
  assert.match(t, /≥ 2\.11/);
  assert.match(t, /Tét: <b>[\d,]+ egység<\/b>/);
  assert.doesNotMatch(t, /onexbet|1xBet|papír/i);
  assert.match(t, /18\+/);
  const imp = formatPublicSignal(sig, { id: 42, improvedFrom: '2.05' });
  assert.match(imp, /^🔔 <b>Jobb odds érhető el<\/b> \(eddig 2\.05\)/);
});

test('tét: negyed-Kelly, legalább 0,25 egység, felső korláttal', () => {
  assert.equal(publicStake(sig), 0.5);                                        // Kelly 2,0% -> negyed 0,51 -> 0,5 E
  assert.equal(publicStake({ ...sig, soft_odds: 2.3, fair_prob: 0.5 }), 2.75); // Kelly 11,5% -> negyed 2,88 -> 2,75 E
  assert.equal(publicStake({ ...sig, soft_odds: 4.2, fair_prob: 0.243 }), 0.25); // nagyon kicsi Kelly -> minimum 0,25 E
  assert.equal(publicStake({ ...sig, soft_odds: 2.6, fair_prob: 0.6 }), 3);    // korlát
});

test('liga-név és emoji', () => {
  assert.equal(leagueName('soccer_germany_liga3'), 'Germany Liga3');
  assert.equal(leagueName('x', { x: 'X liga' }), 'X liga');
  assert.equal(sportEmoji('icehockey_nhl'), '🏒');
});

test('napi eredményposzt: lista, mérleg, 30 napos CLV', () => {
  const rows = [
    { ...sig, result: 'nyert', profit: 1.12, home_score: 2, away_score: 1, public_no: 1 },
    { ...sig, home_team: 'A', away_team: 'B', market: 'h2h', outcome_name: 'A', point: null, sport_key: 'basketball_nba', result: 'vesztett', profit: -1 },
    { ...sig, home_team: 'C', away_team: 'D', result: null, profit: null },
  ];
  const t = formatDailyResults(rows, { elszamolt: 33, profit: -4.74, atlag_clv: 0.031, pozitiv_clv_arany: 0.852 }, { dayLabel: 'november 8-i' });
  assert.match(t, /november 8-i eredmények/);
  assert.match(t, /✅ #1 Örgryte – Brage · Több mint 2\.5.* @2\.12 → nyert \(2–1\)/);
  assert.match(t, /❌ A – B · A győzelem @2\.12 → vesztett/);
  assert.match(t, /1 nyert \/ 1 vesztett<\/b> · 1 még nincs elszámolva/);
  assert.match(t, /Profit: <b>\+0,12 egység<\/b>/);
  assert.match(t, /CLV: <b>\+3,1%<\/b> · pozitív CLV: 85,2%/);
});

test('tegnapi nap határai budapesti idő szerint (téli időszámítás)', () => {
  const { start, end, label } = yesterdayRange(new Date('2026-11-09T08:30:00Z'));
  assert.equal(start.toISOString(), '2026-11-07T23:00:00.000Z');
  assert.equal(end.toISOString(), '2026-11-08T23:00:00.000Z');
  assert.equal(label, 'november 8-i');
  const s = yesterdayRange(new Date('2026-07-15T10:00:00Z'));          // nyári idő
  assert.equal(s.start.toISOString(), '2026-07-13T22:00:00.000Z');
});
