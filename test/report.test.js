import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReport } from '../src/report.js';

test('reggeli riport: odds-sávok és piacok bontással', () => {
  const t = formatReport({
    overall: { jelzes: 10, elszamolt: 8, nyert: 4, vesztett: 4, profit: 1.2, atlag_elony: 0.032, atlag_clv: 0.034, pozitiv_clv_arany: 0.78 },
    byEdge: [{ sav: '2-4%', n: 8, profit: 1, atlag_clv: 0.03 }],
    byOdds: [{ sav: '1,80 alatt', n: 4, elszamolt: 4, profit: 0.8, atlag_clv: 0.02 },
      { sav: '3,50 felett', n: 3, elszamolt: 2, profit: -2, atlag_clv: null }],
    byMarket: [{ piac: 'h2h – döntetlen', n: 3, elszamolt: 3, profit: 1.5, atlag_clv: 0.041 }],
    bySport: [{ sport_key: 'soccer_epl', n: 2, profit: 0.5, atlag_clv: 0.01 }],
  });
  assert.match(t, /<b>Odds-sávok<\/b>\n1,80 alatt: 4 db, profit 0.80, ROI 20.0%, CLV 2.0%\n3,50 felett: 3 db, profit -2.00, ROI -100.0%, CLV –/);
  assert.match(t, /<b>Piacok<\/b>\nh2h – döntetlen: 3 db, profit 1.50, ROI 50.0%, CLV 4.1%/);
  assert.match(t, /<b>Sportágak<\/b>\nsoccer_epl/);
});

test('reggeli riport: bontás nélkül is működik (régi adatforma)', () => {
  const t = formatReport({ overall: { jelzes: 0, elszamolt: 0, nyert: 0, vesztett: 0, profit: 0, atlag_elony: null, atlag_clv: null, pozitiv_clv_arany: null } });
  assert.doesNotMatch(t, /Odds-sávok/);
  assert.match(t, /ROI: <b>–<\/b>/);
});
