import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSignal, parseStart } from '../src/sportfolio/parse.js';
import { analyzeSignal, classifyMarket, isComplementary, formatAnalysis } from '../src/sportfolio/analyze.js';

// Valódi üzenetek a csatornáról (a Telegram-szöveg formájában)
const GINEBRA = `💰 New surebet found!
Profit: 4.15%
Sport: Basketball
League: World. Friendly Clubs
Event: Barangay Ginebra San Miguel - Blackwater Elite Bossing [Full time with overtimes]
Start at : 23 Oct 11:30 UTC

Winlinebet:
▫️TO(217.5) → 2.4
▫️Stake: 43.4 $ Place Bet
Pinnacle:
▫️TU(217.5) → 1.84
▫️Stake: 56.6 $ Place Bet`;

const FINN = `💰 New surebet found!
Profit: 11.62%
Sport: Basketball
League: Finland. Division 1
Event: Lappeenrannan NMKY - Pantterit [1st Half]
Start at : 22 Oct 15:30 UTC

Pinnacle:
▫️Team1 Win → 2.51
▫️Stake: 44.47 $ Place Bet
Winlinebet:
▫️AH2(0.0) → 2.01
▫️Stake: 55.53 $ Place Bet`;

const KAUNO = `💰 New surebet found!
Profit: 4.15%
Sport: Soccer
League: Europe. UEFA Conference League
Event: FK Kauno Zalgiris - Brann [Regular time]
Start at : 22 Oct 16:45 UTC

Pinnacle:
▫️TO(3.0) → 2.91
▫️Stake: 35.79 $ Place Bet
1xbet:
▫️TU(3.0) → 1.622
▫️Stake: 64.21 $ Place Bet`;

const TOCHIGI = `💰 New surebet found!
Profit: 5.1%
Sport: Basketball
League: Japan. B.League
Event: Tochigi Utsunomiya Brex - Shinshu Brave Warriors [Full time with overtimes]
Start at : 24 Oct 08:05 UTC

Winlinebet:
▫️AH1(-8.5) → 2.02
▫️Stake: 51.6 $ Place Bet
Pinnacle:
▫️AH2(+8.5) → 2.15
▫️Stake: 48.4 $ Place Bet`;

const AVGLINE_X2 = `💰 New surebet found!
Profit: 9.25%
Sport: Soccer
League: World. Friendly International Women
Event: Portugal U23 Women - Belgium U23 Women [Regular time]
Start at : 12 Oct 10:30 UTC

BetinAsia:
▫️1 → 2.37
▫️Stake: 46.1 $ Place Bet
Avgline:
▫️X2 → 2.0269241
▫️Stake: 53.9 $ Place Bet`;

test('Ginebra: Winline over 217.5 a megteendő, küszöb 2.20, ~9.6% előny', () => {
  const posted = new Date('2026-10-22T15:43:00Z');
  const s = parseSignal(GINEBRA, posted);
  assert.equal(s.value.book, 'Winlinebet');
  assert.equal(s.ref.book, 'Pinnacle');
  assert.equal(s.startAt.toISOString(), '2026-10-23T11:30:00.000Z');
  const a = analyzeSignal(s, { now: posted });
  assert.ok(a.sameMarket);
  assert.equal(a.threshold, 2.20); // 1/(1-1/1.84)=2.190 -> felfelé kerekítve
  assert.ok(a.edge > 0.09 && a.edge < 0.10);
  assert.match(a.toBet, /több mint 217.5/);
  assert.equal(a.verdict, 'mehet');
});

test('Finn félidő: Team1 Win vs AH2(0.0) eltérő piac -> kihagy', () => {
  const s = parseSignal(FINN, new Date('2026-10-22T15:05:00Z'));
  const a = analyzeSignal(s, { now: new Date('2026-10-22T15:05:00Z') });
  assert.equal(a.sameMarket, false);
  assert.equal(a.verdict, 'kihagy');
});

test('Kauno: 1xBet under 3.0, küszöb 1.53, mehet', () => {
  const now = new Date('2026-10-22T15:54:00Z');
  const a = analyzeSignal(parseSignal(KAUNO, now), { now });
  assert.equal(a.threshold, 1.53);
  assert.equal(a.verdict, 'mehet');
  assert.match(a.toBet, /kevesebb mint 3/);
});

test('Tochigi: hazai -8.5, küszöb 1.87 (a te 1.84-ed alatta volt)', () => {
  const now = new Date('2026-10-24T07:44:30Z');
  const a = analyzeSignal(parseSignal(TOCHIGI, now), { now });
  assert.equal(a.threshold, 1.87);
  assert.match(a.toBet, /^Tochigi Utsunomiya Brex -8.5/);
  assert.ok(1.84 < a.threshold);
});

test('BetinAsia referencia + Avgline X2: kettős esély, komplementer az 1-gyel', () => {
  const now = new Date('2026-10-12T00:36:00Z');
  const a = analyzeSignal(parseSignal(AVGLINE_X2, now), { now });
  assert.ok(a.sameMarket);
  assert.match(a.toBet, /Belgium U23 Women vagy döntetlen/);
  assert.equal(a.threshold, 1.73);
});

test('nem surebet üzenet (capper-tipp) -> null', () => {
  assert.equal(parseSignal('👤 Capper: Evro_5.SOC.L\n🎯 FORECAST: Draw'), null);
});

test('piac-osztályozás és komplementer párok', () => {
  assert.ok(isComplementary(classifyMarket('AH1(-1.5) - Sets'), classifyMarket('AH2(+1.5) - Sets')));
  assert.ok(!isComplementary(classifyMarket('AH1(-1.5)'), classifyMarket('AH2(+2.5)')));
  assert.ok(isComplementary(classifyMarket('TO(3.5) for Team1'), classifyMarket('TU(3.5) for Team1')));
  assert.ok(!isComplementary(classifyMarket('TO(3.5) for Team1'), classifyMarket('TU(3.5)')));
  assert.equal(classifyMarket('EH1(2.0)').type, 'EH');
  assert.ok(isComplementary(classifyMarket('2'), classifyMarket('AH1(+0.5)')));          // MLS-eset
  assert.ok(isComplementary(classifyMarket('Team1 Win'), classifyMarket('AH2(+0.5)')));
  assert.ok(!isComplementary(classifyMarket('Team1 Win'), classifyMarket('AH2(0.0)')));  // a csapda marad
  assert.ok(isComplementary(classifyMarket('AH1(0.0)/DNB'), classifyMarket('AH2(0.0)')));
  assert.ok(isComplementary(classifyMarket('AH1(-1.5) - Maps'), classifyMarket('AH2(+1.5) - Maps')));
});

test('kezdés dátuma év végén átfordul', () => {
  assert.equal(parseStart('2 Jan 18:00 UTC', new Date('2026-12-30T10:00:00Z')).getUTCFullYear(), 2027);
});

test('formázás nem dob, HTML-biztos', () => {
  const now = new Date('2026-10-22T15:54:00Z');
  const s = parseSignal(KAUNO, now);
  const txt = formatAnalysis(s, analyzeSignal(s, { now }));
  assert.match(txt, /≥ 1.53/);
});
