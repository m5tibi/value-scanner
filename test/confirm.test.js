import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameTeam, sameMatch, directionSf, directionOh, makeConfirmTracker, confirmLines } from '../src/sportfolio/confirm.js';
import { parseSignal } from '../src/sportfolio/parse.js';
import { analyzeSignal, formatStakes } from '../src/sportfolio/analyze.js';
import { parseOddsHub, analyzeOddsHub } from '../src/sportfolio/oddshub.js';

// Valódi páros: ugyanaz a meccs két csatornán, eltérő névírással (2026.10.30. 16:43–16:44)
const TPRO = `New odds update on **Pinnacle**

**Football - Austria - Landesliga**
SV Rohrbach vs Lebring
**30.10.2026 18:30**
1.613⬇️ (1.980) - 4.210 (4.070) - 3.530⬆️ (2.570)

🟢 **Opening**
1.862 - 3.110

TippmixPRO
**2.06** - 4.00 - 2.66

💰 **Stake: 2.00u**
**🎯 EV: 118.67%**`;

const NONSTOP = `💰 New surebet found!
Profit: 4.35%
Sport: Soccer
League: Austria. Landesliga
Event: Sv Schermann Rohrbach an der Lafnitz - Lebring [Regular time]
Start at : 30 Oct 17:30 UTC

1xbet:
▫️AH1(-1.0) → 2.83
▫️Stake: 36.87 $ Place Bet
Pinnacle:
▫️AH2(+1.0) → 1.653
▫️Stake: 63.13 $ Place Bet`;

const t0 = new Date('2026-10-30T15:43:43Z');

test('csapatnév-egyezés eltérő írásmóddal', () => {
  assert.ok(sameTeam('SV Rohrbach', 'Sv Schermann Rohrbach an der Lafnitz'));
  assert.ok(sameTeam('Lebring', 'Lebring'));
  assert.ok(sameTeam('Kiekko-Vantaa', 'Kiekko Vantaa'));
  assert.ok(sameTeam('Atlético Madrid', 'Atletico Madrid'));
  assert.ok(!sameTeam('Real Madrid', 'Real Betis'));          // csak általános szó közös
});

test('Rohrbach: a két csatorna ugyanazt az irányt jelzi -> 🔁 megerősítve', () => {
  const oh = parseOddsHub(TPRO, t0);
  const sf = parseSignal(NONSTOP, new Date(t0.getTime() + 18e3));
  const sa = analyzeSignal(sf, { now: t0 });
  assert.ok(sameMatch(oh, sf));
  assert.equal(directionOh(oh), 'home');
  assert.equal(directionSf(sf, sa), 'home');

  const tr = makeConfirmTracker();
  const e1 = { channel: '📊 TPro Value', home: oh.home, away: oh.away, startAt: oh.startAt, dir: 'home', label: 'SV Rohrbach győzelem @2.06 TippmixPRO', at: t0 };
  assert.equal(tr.check(e1, t0).confirms.length, 0);
  tr.add(e1);
  const later = new Date(t0.getTime() + 60e3);
  const e2 = { channel: '📊 Value NonStop', home: sf.home, away: sf.away, startAt: sf.startAt, dir: 'home', label: '-1 @2.83', at: later };
  const cf = tr.check(e2, later);
  assert.equal(cf.confirms.length, 1);
  assert.match(confirmLines(cf, later)[0], /🔁 <b>Megerősítve<\/b>: 📊 TPro Value is jelezte \(1 perce\)/);
});

test('ugyanaz a csatorna nem erősíti meg önmagát; ellenkező irány -> ↔️', () => {
  const tr = makeConfirmTracker();
  const base = { home: 'A FC', away: 'B', startAt: '2026-10-30T18:00:00Z', at: t0 };
  tr.add({ ...base, channel: 'X', dir: 'over', label: 'over' });
  assert.equal(tr.check({ ...base, channel: 'X', dir: 'over' }, t0).confirms.length, 0);
  const cf = tr.check({ ...base, channel: 'Y', dir: 'under' }, t0);
  assert.equal(cf.contradicts.length, 1);
  assert.match(confirmLines(cf, t0)[0], /↔️ <b>Ellentmondás<\/b>/);
  // más kezdési idő -> nem ugyanaz a meccs
  assert.equal(tr.check({ ...base, startAt: '2026-10-31T18:00:00Z', channel: 'Y', dir: 'over' }, t0).confirms.length, 0);
});

test('félidős surebet-jelzés nem vethető össze a teljes meccsel', () => {
  const half = parseSignal(NONSTOP.replace('[Regular time]', '[1st Half]'), t0);
  assert.equal(directionSf(half, analyzeSignal(half, { now: t0 })), null);
});

test('tétlépcső: azonos tétek összevonva', () => {
  assert.equal(formatStakes([{ odds: 2.06, units: 1.5 }, { odds: 1.85, units: 1.5 }, { odds: 1.8, units: 1 }]),
    '<b>1,5 E</b> @2.06–1.85 · 1 E @1.80');
  assert.equal(formatStakes([{ odds: 2.02, units: 1.75 }]), '<b>1,75 E</b> @2.02');
});

test('Rohrbach: 14% Pinnacle-árrésnél a tét max. 1 E', () => {
  const oh = parseOddsHub(TPRO, t0);
  const a = analyzeOddsHub(oh, { now: t0 });
  assert.ok(a.pinMargin > 0.10);
  assert.ok(a.stakes.length && a.stakes.every((x) => x.units <= 1));
  assert.match(a.warnings.join(' '), /nagyon nagy.*max\. 1 E/);
});
