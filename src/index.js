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
import { makeNotifier, formatSignal, bookName } from './telegram.js';
import { describeSelection } from './markets.js';
import { makeDb } from './db.js';
import { isImprovement, improvedHeader, formatLiveReminder, groupByMatch } from './alerts.js';

const cfg = loadConfig();
const log = (...a) => console.log(new Date().toISOString(), ...a);

/**
 * Napi kreditkeret: a budapesti nap szerint számolja, mennyi kreditet használt a bot.
 * Az állapot az adatbázisban van, így ütemezett (cron) futásnál is megmarad.
 */
async function loadBudget(db) {
  const today = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Budapest' }).slice(0, 10);
  const day = await db.getState('credits_day');
  const used = day === today ? Number(await db.getState('credits_used')) || 0 : 0;
  return {
    today, used,
    canSpend(cost) { return !cfg.dailyCreditBudget || this.used + cost <= cfg.dailyCreditBudget; },
    add(cost) { this.used += cost; },
    async save() { await db.setState('credits_day', this.today); await db.setState('credits_used', String(this.used)); },
  };
}

async function scanOnce({ api, db, notify, budget }) {
  const books = [cfg.sharpBook, ...cfg.softBooks];
  let newSignals = 0;
  let improved = 0;
  const rejectedTotal = {};
  const st = { events: 0, withSharp: 0, compared: 0, positive: 0, best: null };

  for (const sport of cfg.sports) {
    if (api.remaining !== null && api.remaining < cfg.minQuotaRemaining) {
      log(`Kvóta alacsony (${api.remaining}), szkennelés leállítva.`);
      break;
    }
    if (budget && !budget.canSpend(cfg.markets.length)) {
      log(`Napi kreditkeret elérve (${budget.used}/${cfg.dailyCreditBudget}), szkennelés holnapig szünetel.`);
      break;
    }
    let events;
    try {
      events = await api.getOdds(sport, { bookmakers: books, markets: cfg.markets, lookaheadHours: cfg.lookaheadHours });
    } catch (e) {
      log(`Hiba (${sport}): ${e.message}`);
      continue;
    } finally {
      // Üres válasz ingyenes; a tényleges költséget a válaszfejléc adja meg.
      budget?.add(api.lastCost ?? 0);
    }
    const { signals, sharpSnapshots, rejected, stats } = scanEvents(events, cfg);
    for (const [k, v] of Object.entries(rejected)) rejectedTotal[k] = (rejectedTotal[k] ?? 0) + v;
    for (const k of ['events', 'withSharp', 'compared', 'positive']) st[k] += stats[k];
    if (stats.best && (!st.best || stats.best.edge > st.best.edge)) st.best = { ...stats.best, sport };

    for (const snap of sharpSnapshots) await db.updateClosing(snap);
    for (const s of signals) {
      if (await db.insertSignal(s)) {
        newSignals++;
        await notify(formatSignal(s));
        continue;
      }
      // Már kiküldtük: csak akkor szólunk újra, ha jobb az odds ÉS a friss Pinnacle-ből számolt előny is nőtt.
      const prev = await db.getNotified(s);
      const cur = { odds: s.soft_odds, edge: s.edge, book: s.soft_book };
      if (isImprovement(prev, cur, { minDelta: cfg.improveMinDelta, maxCount: cfg.improveMax })) {
        const nice = (x) => ({ ...x, book: bookName(x.book) });
        await notify(`${improvedHeader(nice(prev), nice(cur))}\n\n${formatSignal(s)}`);
        await db.markImproved(prev.id, s);
        improved++;
      }
    }
  }
  const b = budget && cfg.dailyCreditBudget ? ` Ma: ${budget.used}/${cfg.dailyCreditBudget}.` : '';
  log(`Szkennelés kész: ${newSignals} új jelzés, ${improved} javulás. Kvóta maradt: ${api.remaining ?? '?'}.${b} Kiszűrve:`, rejectedTotal);
  if (st.events) {
    const best = st.best
      ? ` Legjobb: ${(st.best.edge * 100).toFixed(1)}% (${st.best.sport}: ${st.best.label} @ ${st.best.book} ${st.best.price}, fair ${st.best.fair_odds.toFixed(2)})`
      : '';
    log(`Vizsgálva: ${st.events} meccs (Pinnacle-lel: ${st.withSharp}), ${st.compared} összevetés, ebből pozitív előny: ${st.positive}.${best}`);
  }
}

async function settleOnce({ api, db, budget }) {
  const sports = await db.openSportsToSettle();
  let settled = 0;
  for (const sport of sports) {
    // Az elszámolás fontosabb a szkennelésnél, ezért a keretet itt csak figyelmeztetésként kezeljük.
    let games;
    try { games = await api.getScores(sport, 3); } catch (e) { log(`Eredmény-hiba (${sport}): ${e.message}`); continue; }
    finally { budget?.add(api.lastCost ?? 0); }
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

/** ⏰ Kezdési emlékeztető: a kiküldött jelzésekről, meccsenként egy üzenet. Nem kér le semmit az API-ból. */
async function liveRemindersOnce({ db, notify }) {
  const rows = await db.dueLiveReminders(cfg.liveReminderWindowMin);
  const matches = groupByMatch(rows, (r) => r.event_id,
    (r) => ({ home: r.home_team, away: r.away_team, sport: r.sport_key, league: r.sport_key, startAt: r.commence_time }),
    (r) => ({
      toBet: describeSelection({ market: r.market, name: r.outcome_name, point: r.point == null ? undefined : Number(r.point) }, r),
      book: bookName(r.notified_book ?? r.soft_book), odds: Number(r.notified_odds ?? r.soft_odds), threshold: r.min_odds,
    }));
  for (const m of matches) {
    await notify(formatLiveReminder(m));
    await db.markLiveReminded(m.ids);
  }
  if (matches.length) log(`Kezdési emlékeztető: ${matches.length} meccs.`);
}

/** Egy kör: mindig szkennel; elszámol, ha letelt SETTLE_INTERVAL_MIN; riportot küld naponta egyszer 9:00 után. */
async function tick({ api, db, notify }) {
  const budget = await loadBudget(db);
  await scanOnce({ api, db, notify, budget }).catch((e) => log('Szkennelési hiba:', e.message));
  if (cfg.liveReminder) await liveRemindersOnce({ db, notify }).catch((e) => log('Emlékeztető-hiba:', e.message));

  const lastSettle = Number(await db.getState('last_settle_ms')) || 0;
  if (Date.now() - lastSettle > cfg.settleIntervalMin * 60e3) {
    await settleOnce({ api, db, budget }).catch((e) => log('Elszámolási hiba:', e.message));
    await db.setState('last_settle_ms', String(Date.now()));
  }
  await budget.save();

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
