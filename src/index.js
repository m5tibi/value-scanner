// Belépési pont.
//   node src/index.js            -> folyamatos futás (szkennelés + elszámolás + napi riport)
//   node src/index.js --once     -> egy szkennelés, majd kilép
//   node src/index.js --settle   -> egy elszámolási kör
//   node src/index.js --report   -> riport a konzolra (és Telegramra)
//   node src/index.js --migrate  -> tábla létrehozása

import { loadConfig } from './config.js';
import { OddsApi } from './oddsApi.js';
import { scanEvents } from './scanner.js';
import { settleSignal, parseScores } from './settle.js';
import { makeNotifier, formatSignal } from './telegram.js';
import { makeDb } from './db.js';

const cfg = loadConfig();
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function scanOnce({ api, db, notify }) {
  const books = [cfg.sharpBook, ...cfg.softBooks];
  let newSignals = 0;
  const rejectedTotal = {};

  for (const sport of cfg.sports) {
    if (api.remaining !== null && api.remaining < cfg.minQuotaRemaining) {
      log(`Kvóta alacsony (${api.remaining}), szkennelés leállítva.`);
      break;
    }
    let events;
    try {
      events = await api.getOdds(sport, { bookmakers: books, markets: cfg.markets, lookaheadHours: cfg.lookaheadHours });
    } catch (e) {
      log(`Hiba (${sport}): ${e.message}`);
      continue;
    }
    const { signals, sharpSnapshots, rejected } = scanEvents(events, cfg);
    for (const [k, v] of Object.entries(rejected)) rejectedTotal[k] = (rejectedTotal[k] ?? 0) + v;

    for (const snap of sharpSnapshots) await db.updateClosing(snap);
    for (const s of signals) {
      if (await db.insertSignal(s)) {
        newSignals++;
        await notify(formatSignal(s));
      }
    }
  }
  log(`Szkennelés kész: ${newSignals} új jelzés. Kvóta maradt: ${api.remaining ?? '?'}. Kiszűrve:`, rejectedTotal);
}

async function settleOnce({ api, db }) {
  const sports = await db.openSportsToSettle();
  let settled = 0;
  for (const sport of sports) {
    let games;
    try { games = await api.getScores(sport, 3); } catch (e) { log(`Eredmény-hiba (${sport}): ${e.message}`); continue; }
    for (const g of games) {
      const sc = parseScores(g);
      if (!sc) continue;
      for (const sig of await db.unsettledForEvent(g.id)) {
        const r = settleSignal(sig, sc.home, sc.away);
        await db.saveSettlement(sig.id, { ...sc, ...r });
        settled++;
      }
    }
  }
  log(`Elszámolás kész: ${settled} jelzés.`);
}

function pct(x) { return x === null || x === undefined ? '–' : `${(x * 100).toFixed(1)}%`; }

async function reportOnce({ db, notify }, days = 30) {
  const { overall: o, bySport, byEdge } = await db.report(days);
  const decided = o.nyert + o.vesztett;
  const lines = [
    `📊 <b>Papíros value-riport (utolsó ${days} nap)</b>`,
    `Jelzés: ${o.jelzes} | elszámolt: ${o.elszamolt} | nyert/vesztett: ${o.nyert}/${o.vesztett}` +
      (decided ? ` (${pct(o.nyert / decided)})` : ''),
    `Profit: <b>${o.profit.toFixed(2)} egység</b> | ROI: <b>${o.elszamolt ? pct(o.profit / o.elszamolt) : '–'}</b>`,
    `Átlagos előny jelzéskor: ${pct(o.atlag_elony)}`,
    `Átlagos CLV: <b>${pct(o.atlag_clv)}</b> | pozitív CLV aránya: ${pct(o.pozitiv_clv_arany)}`,
    ``,
    `<b>Előny-sávok</b>`,
    ...byEdge.map((r) => `${r.sav}: ${r.n} db, profit ${r.profit.toFixed(2)}, CLV ${pct(r.atlag_clv)}`),
    ``,
    `<b>Sportágak</b>`,
    ...bySport.map((r) => `${r.sport_key}: ${r.n} db, profit ${r.profit.toFixed(2)}, CLV ${pct(r.atlag_clv)}`),
    ``,
    `ℹ️ A CLV a legfontosabb szám: ha tartósan pozitív, a jelzések valódi előnyt mutatnak.`,
  ];
  await notify(lines.join('\n'));
}

/** Egy kör: mindig szkennel; elszámol, ha letelt SETTLE_INTERVAL_MIN; riportot küld naponta egyszer 9:00 után. */
async function tick({ api, db, notify }) {
  await scanOnce({ api, db, notify }).catch((e) => log('Szkennelési hiba:', e.message));

  const lastSettle = Number(await db.getState('last_settle_ms')) || 0;
  if (Date.now() - lastSettle > cfg.settleIntervalMin * 60e3) {
    await settleOnce({ api, db }).catch((e) => log('Elszámolási hiba:', e.message));
    await db.setState('last_settle_ms', String(Date.now()));
  }

  const [day, time] = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Budapest' }).split(' ');
  if (time >= '09:00:00' && (await db.getState('last_report_day')) !== day) {
    await reportOnce({ db, notify }).catch((e) => log('Riport-hiba:', e.message));
    await db.setState('last_report_day', day);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const db = makeDb(cfg.databaseUrl);
  const notify = makeNotifier({ token: cfg.telegramToken, chatId: cfg.telegramChatId, log });

  try {
    if (args.has('--migrate')) { await db.migrate(); log('Tábla kész.'); return; }
    if (args.has('--report')) { await reportOnce({ db, notify }); return; }

    const api = new OddsApi({ apiKey: cfg.oddsApiKey });
    await db.migrate();
    if (args.has('--once')) { await scanOnce({ api, db, notify }); return; }
    if (args.has('--settle')) { await settleOnce({ api, db }); return; }

    // --tick: egy teljes kör (szkennelés + esedékes elszámolás + esedékes riport), majd kilép.
    // Ütemezőhöz (Render Cron Job, GitHub Actions) való; az állapotot az adatbázis tárolja.
    if (args.has('--tick')) { await tick({ api, db, notify }); return; }

    // Folyamatos futás (Render Background Worker)
    log(`Indulás: ${cfg.sports.length} sport, piacok: ${cfg.markets.join(',')}, ${cfg.scanIntervalMin} percenként.`);
    for (;;) {
      await tick({ api, db, notify }).catch((e) => log('Hiba a körben:', e.message));
      await new Promise((r) => setTimeout(r, cfg.scanIntervalMin * 60e3));
    }
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
