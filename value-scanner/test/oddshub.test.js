import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOddsHub, analyzeOddsHub, formatOddsHub, markEmphasis, budapestTime, estimateAtLine } from '../src/sportfolio/oddshub.js';

// Valódi üzenetek (TPro Value / Tippmix Value), a kiemelt odds **...**-gal
const ROKI = `New odds update on **Pinnacle**

**Hockey - Finland - Mestis**
Kiekko-Vantaa vs Roki
**30.10.2026 17:30**
1.833⬆️ (1.680) - 1.909⬇️ (2.100)

🟢 **Opening**
1.595 - 2.250

TippmixPRO
1.51 - **2.23**

💰 **Stake: 2.00u**
**🎯 EV: 108.99%**`;

const HANDBALL = `New odds update on **Pinnacle**

**Handball - Germany - Bundesliga**
SG BBM Bietigheim vs HC Erlangen
**30.10.2026 19:00**

**Totals (59.5) (alt. line)**
1.637⬇️ (1.741) - 2.280⬆️ (2.110)

🟢 **Opening (59)**
1.909 - 1.909

TippmixPRO (Totals 59.5)
**1.85** - 1.83

💰 **Stake: 2.00u**
**🎯 EV: 108.82%**`;

const FOOTBALL_3W = `New odds update on **Pinnacle**

**Football - Germany - DFB Pokal Women**
Hamburger SV vs Union Berlin
**31.10.2026 13:00**
2.860⬆️ (2.460) - 3.970 (3.970) - 1.934⬇️ (2.170)

🟢 **Opening**
1.970 - 2.950

TippmixPRO
2.51 - 3.70 - **2.27**

💰 **Stake: 2.00u**
**🎯 EV: 108.49%**`;

const GRINDAVIK = `New odds update on **Pinnacle**

**Basketball - Iceland - Premier League**
UMF Grindavik vs UMF Njardvik
**30.10.2026 20:30**

**Totals (185)**
1.729⬇️ (1.833) - 1.943⬆️ (1.833)

🟢 **Opening (180)**
1.854 - 1.813

Tippmix (Totals 182.5)
1.78 - 1.83

🎯 EV: None (not equal lines)`;

const ZUG_BLUE_OPENING = `New odds update on **Pinnacle**

**Hockey - Switzerland - Nationalliga A**
EV Zug vs SCL Tigers
**30.10.2026 19:45**
1.473⬇️ (1.558) - 2.670⬆️ (2.440)

🔵 **Opening**
1.473 - 2.680

TippmixPRO
**1.61** - 2.33

💰 **Stake: 2.00u**
**🎯 EV: 105.66%**`;

const now = new Date('2026-10-30T13:50:00Z');
const run = (t) => { const s = parseOddsHub(t, now); return { s, a: analyzeOddsHub(s, { now }) }; };

test('időpont: budapesti helyi idő (téli időszámítás: UTC+1)', () => {
  assert.equal(budapestTime('30.10.2026 17:30').toISOString(), '2026-10-30T16:30:00.000Z');
  assert.equal(budapestTime('15.07.2026 20:00').toISOString(), '2026-07-15T18:00:00.000Z'); // nyári: UTC+2
});

test('Roki: vendég győzelem, a csatorna EV-jével egyezik, nagy árrés miatt óvatosan', () => {
  const { s, a } = run(ROKI);
  assert.equal(s.home, 'Kiekko-Vantaa');
  assert.equal(s.pick, 1);
  assert.equal(s.pickFrom, 'kiemelés');
  assert.equal(s.soft.book, 'TippmixPRO');
  assert.ok(Math.abs(a.edge - s.theirEv) < 0.005);
  assert.match(a.toBet, /^Roki győzelem \(hosszabbítással/);
  assert.equal(a.consThreshold, 2.21);
  assert.equal(a.verdict, 'ovatosan');
  assert.match(a.warnings.join(' '), /árrése itt nagy/);
  assert.ok(a.stakes[0].units <= 1.5);
  assert.match(a.hint, /Ki nyeri\? – Teljes esemény/);
});

test('Kézilabda alt. vonal: over 59,5, mehet', () => {
  const { s, a } = run(HANDBALL);
  assert.deepEqual(s.market, { type: 'totals', line: 59.5, alt: true });
  assert.equal(s.soft.line, 59.5);
  assert.equal(s.pick, 0);
  assert.equal(a.toBet, 'Több mint 59,5 gól');
  assert.equal(a.verdict, 'mehet');
  assert.ok(Math.abs(a.edge - s.theirEv) < 0.005);
  assert.match(a.hint, /Gólszám – Rendes játékidő/);
});

test('Foci 1X2: háromesélyes, vendég győzelem', () => {
  const { s, a } = run(FOOTBALL_3W);
  assert.equal(s.pin.length, 3);
  assert.equal(s.pick, 2);
  assert.equal(a.toBet, 'Union Berlin győzelem (1X2, rendes játékidő)');
  assert.ok(Math.abs(a.edge - s.theirEv) < 0.005);
});

test('Eltérő vonal (EV: None): a ⬇️ oldal, becsült fair a 182,5-ös vonalra', () => {
  const { s, a } = run(GRINDAVIK);
  assert.equal(s.pick, 0);
  assert.equal(s.pickFrom, 'nyíl');
  assert.equal(s.theirEv, null);
  assert.equal(a.estimated, true);
  assert.equal(a.toBet, 'Több mint 182,5 pont');
  assert.ok(a.fairOdds > 1.65 && a.fairOdds < 1.74);
  assert.ok(a.stakes.every((x) => x.units <= 1));
  // ha közben 1,71-re esett (ahogy a valóságban), már nincs value
  const s2 = parseOddsHub(GRINDAVIK.replace('1.78 - 1.83', '1.71 - 1.90'), now);
  assert.equal(analyzeOddsHub(s2, { now }).verdict, 'kihagy');
});

test('kék Opening-jel és hazai kiemelés', () => {
  const { s, a } = run(ZUG_BLUE_OPENING);
  assert.equal(s.pick, 0);
  assert.deepEqual(s.opening.odds, [1.473, 2.68]);
  assert.equal(a.verdict, 'mehet');
});

test('nem ilyen üzenet -> null', () => {
  assert.equal(parseOddsHub('💰 New surebet found!\nProfit: 4%'), null);
});

test('Telegram-entitásokból kiemelés (félkövér és aláhúzott, átfedéssel is)', () => {
  const text = 'TippmixPRO\n1.51 - 2.23';
  const off = text.indexOf('2.23');
  const marked = markEmphasis(text, [
    { className: 'MessageEntityBold', offset: off, length: 4 },
    { className: 'MessageEntityUnderline', offset: off, length: 4 },
    { className: 'MessageEntityTextUrl', offset: 0, length: 10 },
  ]);
  assert.equal(marked, 'TippmixPRO\n1.51 - **2.23**'); // azonos tartomány csak egyszer
  const plain = ROKI.replace(/\*\*/g, '');
  const s = parseOddsHub(markEmphasis(plain, [{ className: 'MessageEntityUnderline', offset: plain.indexOf('2.23'), length: 4 }]), now);
  assert.equal(s.pick, 1);
});

test('becslő modellek: azonos vonalon visszaadja a bemenetet, a lejjebb lévő over-vonal valószínűbb', () => {
  const same = estimateAtLine({ sport: 'Hockey', type: 'totals', pinLine: 5.5, pFirst: 0.48, softLine: 5.5 });
  assert.ok(Math.abs(same - 0.48) < 0.001);
  assert.ok(estimateAtLine({ sport: 'Football', type: 'totals', pinLine: 2.5, pFirst: 0.5, softLine: 1.5 }) > 0.7);
  assert.equal(estimateAtLine({ sport: 'Football', type: 'totals', pinLine: 2.25, pFirst: 0.5, softLine: 2.5 }), null); // negyedes vonal
  assert.equal(estimateAtLine({ sport: 'Volleyball', type: 'totals', pinLine: 180.5, pFirst: 0.5, softLine: 178.5 }), null);
});

test('formázás: HTML-biztos, másolható nevek', () => {
  const { s, a } = run(ROKI);
  const txt = formatOddsHub(s, a, { channel: 'TPro Value' });
  assert.match(txt, /<code>Kiekko-Vantaa<\/code> – <code>Roki<\/code>/);
  assert.match(txt, /Jégkorong · <code>Finland - Mestis<\/code>/);
  assert.match(txt, /Biztos: odds <b>≥ 2\.21<\/b> · minimum ≥ 2\.09/);
});
