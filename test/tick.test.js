// A teljes szkennelési kör (tick) futtatása kamu API-val és memóriás adatbázissal – a nyilvános csatornával együtt.
// Azért van, hogy egy hiányzó függvény vagy hibás bekötés (mint a 2026-11-09-i leagueTitles-hiba) teszten bukjon el.
import { test } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  ODDS_API_KEY: 'x', DATABASE_URL: 'postgres://teszt', SPORTS: 'auto', MARKETS: 'totals', SOFT_BOOKS: 'onexbet',
  DAILY_CREDIT_BUDGET: '0', MIN_QUOTA_REMAINING: '0', LOOKAHEAD_HOURS: '24', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'PRIVAT',
  PUBLIC_CHAT_ID: 'NYILVANOS', SETTLE_INTERVAL_MIN: '100000',
});
const { tick } = await import('../src/index.js');
const { makeNotifier } = await import('../src/telegram.js');

function memDb() {
  const state = new Map(), signals = [];
  return {
    signals, state,
    getState: async (k) => state.get(k) ?? null,
    setState: async (k, v) => { state.set(k, String(v)); },
    insertSignal: async (s) => { if (signals.some((x) => x.event_id === s.event_id && x.market === s.market && x.group_key === s.group_key && x.outcome_name === s.outcome_name)) return null; signals.push({ ...s, id: signals.length + 1 }); return signals.length; },
    getNotified: async () => null, markImproved: async () => {}, updateClosing: async () => {},
    nextPublicNo: async () => Math.max(0, ...signals.map((x) => x.public_no ?? 0)) + 1,
    markPublic: async (id, stake, no) => { signals[id - 1].public_stake = stake; signals[id - 1].public_no = no; }, isPublic: async () => null,
    openSportsToSettle: async () => [], report: async () => ({ overall: {} }), publicSignalsBetween: async () => [],
  };
}

const start = new Date(Date.now() + 5 * 3600e3).toISOString();
const fresh = new Date(Date.now() - 30e3).toISOString();
const SPORTS = [{ key: 'soccer_sweden_superettan', group: 'Soccer', title: 'Superettan', active: true, has_outrights: false }];
const ev = { id: 'e1', sport_key: 'soccer_sweden_superettan', home_team: 'Örgryte', away_team: 'Brage', commence_time: start, bookmakers: [
  { key: 'pinnacle', last_update: fresh, markets: [{ key: 'totals', last_update: fresh, outcomes: [{ name: 'Over', point: 2.5, price: 2.0 }, { name: 'Under', point: 2.5, price: 1.87 }] }] },
  { key: 'onexbet', last_update: fresh, markets: [{ key: 'totals', last_update: fresh, outcomes: [{ name: 'Over', point: 2.5, price: 2.12 }, { name: 'Under', point: 2.5, price: 1.7 }] }] },
] };
const ev2 = { ...ev, id: 'e2', home_team: 'Öster', away_team: 'Utsikten' };
const api = {
  remaining: 9000, lastCost: 0,
  async getSports() { return SPORTS; },
  // csak a saját ligájában van meccs (a feltérképezésnél 2 összevethető kell, hogy kiválassza)
  async getOdds(sport, { markets }) {
    if (sport !== 'soccer_sweden_superettan') { this.lastCost = 0; return []; }
    this.lastCost = markets.length; return [ev, ev2];
  },
  async getScores() { return []; },
};

test('teljes kör: feltérképezés, jelzés a privát ÉS a nyilvános csatornába, napi diagnosztika', async () => {
  const db = memDb();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' });
  await db.setState('last_report_day', today);       // a napi riportot itt nem teszteljük
  await db.setState('last_public_daily', today);
  const sent = [];
  const fetchImpl = async (url, opts) => { sent.push(JSON.parse(opts.body)); return new Response('{"ok":true}', { status: 200 }); };
  const quiet = { log() {}, sleep: async () => {} };
  const notify = makeNotifier({ token: 't', chatId: 'PRIVAT', fetchImpl, ...quiet });
  const publicNotify = makeNotifier({ token: 't', chatId: 'NYILVANOS', fetchImpl, ...quiet });

  const origLog = console.log; console.log = () => {};
  try { await tick({ api, db, notify, publicNotify }); } finally { console.log = origLog; }

  assert.ok(!sent.some((m) => /Szkennelési hiba/.test(m.text)), 'nem lehet szkennelési hiba');
  assert.equal(db.signals.length, 2);
  const pub = sent.find((m) => m.chat_id === 'NYILVANOS');
  assert.ok(pub, 'a nyilvános csatornába ki kell mennie');
  assert.match(pub.text, /Mondom a Tutit! · Value/);
  assert.match(pub.text, /Superettan/);                   // liga-név a feltérképezésből (leagueTitles)
  assert.ok(sent.some((m) => m.chat_id === 'PRIVAT' && /Value \(papír\)/.test(m.text)));
  assert.equal(db.signals[0].public_stake, 0.5);
  assert.deepEqual(db.signals.map((x) => x.public_no), [1, 2]);             // nyilvános sorszám 1-től
  assert.match(sent.filter((m) => m.chat_id === 'NYILVANOS')[0].text, /· #1\n/);
  const diag = JSON.parse(db.state.get(`diag_${today}`));
  assert.equal(diag.signals, 2);
  assert.equal(diag.byMarket.totals.value, 2);
});
