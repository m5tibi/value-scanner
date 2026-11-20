import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysUntilReset, computeDailyBudget, planDailyBudget } from '../src/budget.js';

const memDb = (init = {}) => { const st = { ...init }; return { st, getState: async (k) => st[k] ?? null, setState: async (k, v) => { st[k] = v; } }; };
const cfg = { dailyCreditFallback: 450, creditOtherDaily: 175, minQuotaRemaining: 1500, dailyCreditMin: 100, dailyCreditMax: 1500 };

test('hátralévő napok a havi nullázásig', () => {
  assert.equal(daysUntilReset(new Date('2026-11-20T11:00:00Z')), 11);
  assert.equal(daysUntilReset(new Date('2026-11-30T23:30:00Z')), 1);
  assert.equal(daysUntilReset(new Date('2026-12-01T00:30:00Z')), 31);
});

test('napi keret: nov. 20., 9971 kredit maradt -> ~600', () => {
  const r = computeDailyBudget({ remaining: 9971, now: new Date('2026-11-20T11:00:00Z'), reserve: 1500, otherDaily: 175 });
  assert.equal(r.days, 11);
  assert.equal(r.budget, 595);
});

test('napi keret: alsó és felső korlát', () => {
  assert.equal(computeDailyBudget({ remaining: 1600, now: new Date('2026-11-20T11:00:00Z'), reserve: 1500, otherDaily: 175, min: 100 }).budget, 100);
  assert.equal(computeDailyBudget({ remaining: 20000, now: new Date('2026-11-30T12:00:00Z'), reserve: 1500, otherDaily: 175, max: 1500 }).budget, 1500);
});

test('terv: naponta egyszer, friss kvótából; elavult (előző havi) kvótánál alapérték, majd újratervez', async () => {
  const db = memDb({ quota_remaining: '9971', quota_remaining_month: '2026-11' });
  const now = new Date('2026-11-20T11:00:00Z');
  assert.equal((await planDailyBudget(db, { today: '2026-11-20', cfg, now })).budget, 595);
  db.st.quota_remaining = '5000'; // ugyanazon a napon nem tervez újra
  assert.equal((await planDailyBudget(db, { today: '2026-11-20', cfg, now })).budget, 595);

  const dec = new Date('2026-12-01T00:10:00Z');
  const db2 = memDb({ quota_remaining: '1700', quota_remaining_month: '2026-11' });
  assert.equal((await planDailyBudget(db2, { today: '2026-12-01', cfg, now: dec })).budget, 450);
  db2.st.quota_remaining = '19990'; db2.st.quota_remaining_month = '2026-12';
  const b = (await planDailyBudget(db2, { today: '2026-12-01', cfg, now: dec })).budget;
  assert.equal(b, Math.floor((19990 - 1500 - 175 * 31) / 31));
});

test('terv: a többi felhasználó fogyasztását a tegnapi adatból méri', async () => {
  // tegnap reggel 10600 volt, ma 9971; a szkenner tegnap 400-at használt -> mások ~229/nap
  const db = memDb({ quota_remaining: '9971', quota_remaining_month: '2026-11', auto_budget_base: '10600', auto_budget_prev_used: '400' });
  const r = await planDailyBudget(db, { today: '2026-11-20', cfg, now: new Date('2026-11-20T11:00:00Z') });
  assert.equal(r.budget, Math.floor((9971 - 1500 - 229 * 11) / 11));
});
