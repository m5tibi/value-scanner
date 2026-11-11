import { pathToFileURL } from 'node:url';
// Belépési pont.
//   node src/index.js            -> folyamatos futás (szkennelés + elszámolás + napi riport)
//   node src/index.js --once     -> egy szkennelés, majd kilép
//   node src/index.js --settle   -> egy elszámolási kör
//   node src/index.js --report   -> riport a konzolra (és Telegramra)
//   node src/index.js --migrate  -> tábla létrehozása
//   node src/index.js --discover -> liga-feltérképezés (SPORTS=auto esetén hetente magától is lefut)

import { loadConfig } from './config.js';
import { OddsApi } from './oddsApi.js';
import { scanEvents } from './scanner.js';
import { settleSignal, parseScores } from './settle.js';
import { makeNotifier, formatSignal, bookName } from './telegram.js';
import { makeDb } from './db.js';
import { isImprovement, improvedHeader } from './alerts.js';
import { discoverOnce, discoveryDue, rotate, pickSports } from './discover.js';
import { formatPublicSignal, formatDailyResults, publicStake, yesterdayRange } from './public.js';

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

const FALLBACK_SPORTS = ['soccer_epl', 'soccer_uefa_champs_league', 'basketball_euroleague'];

/** A szkennelendő sportok: SPORTS=auto esetén a feltérképezés eredménye, különben a megadott lista. */
async function resolveSports(db) {
  if (!cfg.sports.includes('auto')) return cfg.sports;
  const extra = cfg.sports.filter((s) => s !== 'auto'); // SPORTS=auto,soccer_epl -> a feltérképezett + ezek
  // A rangsort mindig az elmentett feltérképezésből számolja újra (kredit nélkül), így a szabályok változása azonnal érvényes.
  let auto = [];
  try {
    const saved = JSON.parse((await db.getState('discover_result')) ?? 'null');
    if (saved?.results?.length) auto = pickSports(saved.results, { top: cfg.discoverTop });
  } catch { /* régi/hibás állapot */ }
  if (!auto.length) auto = ((await db.getState('auto_sports')) ?? '').split(',').filter(Boolean);
  const all = [...new Set([...(auto.length ? auto : FALLBACK_SPORTS), ...extra])];
  return all;
}

const budapestDay = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' });

/** Napi szkennelési diagnosztika összegzése (value_bot_state: diag_YYYY-MM-DD). */
async function addDiag(db, x) {
  const key = `diag_${budapestDay()}`;
  const d = JSON.parse((await db.getState(key)) ?? 'null') ?? { ticks: 0, skipped: 0, credits: 0, events: 0, compared: 0, positive: 0, signals: 0, byMarket: {}, best: null };
  for (const k of ['ticks', 'skipped', 'credits', 'events', 'compared', 'positive', 'signals']) d[k] += x[k] ?? 0;
  for (const [m, v] of Object.entries(x.byMarket ?? {})) {
    const t = (d.byMarket[m] ??= { compared: 0, positive: 0, value: 0, best: null });
    t.compared += v.compared; t.positive += v.positive; t.value += v.value;
    if (v.best !== null && (t.best === null || v.best > t.best)) t.best = v.best;
  }
  if (x.best && (!d.best || x.best.edge > d.best.edge)) d.best = { edge: x.best.edge, label: x.best.label, book: x.best.book, price: x.best.price };
  await db.setState(key, JSON.stringify(d));
}

/** A tegnapi diagnosztika szövegesen a reggeli riporthoz. */
async function diagText(db) {
  const y = budapestDay(new Date(Date.now() - 86_400_000));
  const d = JSON.parse((await db.getState(`diag_${y}`)) ?? 'null');
  if (!d) return null;
  const p = (x) => `${(x * 100).toFixed(1)}%`;
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const lines = [
    `🔧 <b>Tegnapi szkennelés</b> (${y})`,
    `${d.ticks} kör (${d.skipped} kihagyva a keret miatt) · ${d.credits} kredit`,
    `${d.events} meccs · ${d.compared} összevetés · pozitív előny: ${d.positive} · jelzés: ${d.signals}`,
    ...Object.entries(d.byMarket).map(([m, v]) => `• ${m}: ${v.compared} összevetés, ${v.positive} pozitív, ${v.value} ≥ küszöb, legjobb ${v.best === null ? '–' : p(v.best)}`),
  ];
  if (d.best) lines.push(`Legjobb: ${p(d.best.edge)} – ${esc(d.best.label)} @ ${d.best.book} ${d.best.price}`);
  return lines.join('\n');
}

/** Liga-nevek a feltérképezésből (kulcs -> cím), a nyilvános üzenetekhez. */
async function leagueTitles(db) {
  try {
    const saved = JSON.parse((await db.getState('discover_result')) ?? 'null');
    return Object.fromEntries((saved?.results ?? []).map((r) => [r.key, r.title]));
  } catch { return {}; }
}

/**
 * Egy körre jutó kredit: a napi maradék elosztva a nap hátralévő köreire. A tört részt "gyűjti" (scan_carry),
 * és csak akkor költ, ha összegyűlt legalább egy liga ára – így a keret egyenletesen oszlik el a napon,
 * és este sem fogy el.
 */
async function tickAllowance(db, budget) {
  if (!budget || !cfg.dailyCreditBudget) return Infinity;
  const remaining = cfg.dailyCreditBudget - budget.used;
  if (remaining < cfg.markets.length) return 0;
  const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Budapest', hour12: false }).split(':').map(Number);
  const ticksLeft = Math.max(1, Math.ceil((24 * 60 - (h * 60 + m)) / cfg.tickMinutes));
  const carry = (Number(await db.getState('scan_carry')) || 0) + remaining / ticksLeft;
  return Math.min(carry, remaining);
}

async function scanOnce({ api, db, notify, publicNotify, budget }) {
  const titles = publicNotify ? await leagueTitles(db) : {};
  const books = [cfg.sharpBook, ...cfg.softBooks].slice(0, 10);
  const allSports = await resolveSports(db);
  // Körforgás: az előző kör után folytatja; a kör kreditkeretéig halad (az üres válasz ingyenes, azt átugorja).
  const pointer = Number(await db.getState('scan_pointer')) || 0;
  const { batch: ordered } = rotate(allSports, pointer, allSports.length);
  const allowance = await tickAllowance(db, budget);
  if (allowance < cfg.markets.length) {
    // Még nem gyűlt össze egy liga ára: ezt a kört kihagyjuk, a keretet viszük tovább.
    await db.setState('scan_carry', String(allowance));
    await addDiag(db, { skipped: 1 }).catch(() => {});
    log(`Kör kihagyva: gyűlik a keret (${allowance.toFixed(2)}/${cfg.markets.length} kredit). Ma: ${budget?.used ?? '?'}/${cfg.dailyCreditBudget}.`);
    return;
  }
  let spentThisTick = 0, scanned = 0;
  let newSignals = 0;
  let improved = 0;
  const rejectedTotal = {};
  const st = { events: 0, withSharp: 0, compared: 0, positive: 0, best: null };

  for (const sport of ordered) {
    if (spentThisTick >= allowance) break;
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
      spentThisTick += api.lastCost ?? 0;
      scanned++;
    }
    const { signals, sharpSnapshots, rejected, stats } = scanEvents(events, cfg);
    for (const [k, v] of Object.entries(rejected)) rejectedTotal[k] = (rejectedTotal[k] ?? 0) + v;
    for (const k of ['events', 'withSharp', 'compared', 'positive']) st[k] += stats[k];
    for (const [m, v] of Object.entries(stats.byMarket ?? {})) {
      const t = ((st.byMarket ??= {})[m] ??= { compared: 0, positive: 0, value: 0, best: null });
      t.compared += v.compared; t.positive += v.positive; t.value += v.value;
      if (v.best !== null && (t.best === null || v.best > t.best)) t.best = v.best;
    }
    if (stats.best && (!st.best || stats.best.edge > st.best.edge)) st.best = { ...stats.best, sport };

    for (const snap of sharpSnapshots) await db.updateClosing(snap);
    for (const s of signals) {
      const newId = await db.insertSignal(s);
      if (newId) {
        newSignals++;
        await notify(formatSignal(s));
        if (publicNotify && s.edge >= Math.max(cfg.minEdge, cfg.publicMinEdge)) {
          const stake = publicStake(s, cfg.publicStake);
          const no = await db.nextPublicNo();
          if (await publicNotify(formatPublicSignal(s, { id: no, titles, stake: cfg.publicStake }))) await db.markPublic(newId, stake, no);
        }
        continue;
      }
      // Már kiküldtük: csak akkor szólunk újra, ha jobb az odds ÉS a friss Pinnacle-ből számolt előny is nőtt.
      const prev = await db.getNotified(s);
      const cur = { odds: s.soft_odds, edge: s.edge, book: s.soft_book };
      if (isImprovement(prev, cur, { minDelta: cfg.improveMinDelta, maxCount: cfg.improveMax })) {
        const nice = (x) => ({ ...x, book: bookName(x.book) });
        await notify(`${improvedHeader(nice(prev), nice(cur))}\n\n${formatSignal(s)}`);
        const pubNo = publicNotify ? await db.isPublic(prev.id) : null;
        if (pubNo) {
          await publicNotify(formatPublicSignal(s, { id: pubNo === true ? null : pubNo, titles, stake: cfg.publicStake, improvedFrom: Number(prev.odds).toFixed(2) }));
        }
        await db.markImproved(prev.id, s);
        improved++;
      }
    }
  }
  await db.setState('scan_pointer', String((pointer + scanned) % Math.max(1, allSports.length)));
  await addDiag(db, { ticks: 1, credits: spentThisTick, events: st.events, compared: st.compared,
    positive: st.positive, signals: newSignals, byMarket: st.byMarket, best: st.best }).catch(() => {});
  // Ha egy körben több liga is fizetős volt, a túlköltést a következő körök "visszafizetik" (negatív carry).
  if (allowance !== Infinity) await db.setState('scan_carry', String(Math.max(-2 * cfg.markets.length, allowance - spentThisTick)));
  const b = budget && cfg.dailyCreditBudget ? ` Ma: ${budget.used}/${cfg.dailyCreditBudget}.` : '';
  log(`Kör: ${scanned}/${allSports.length} liga, ${spentThisTick} kredit (keret erre a körre: ${allowance === Infinity ? '∞' : allowance.toFixed(1)}).`);
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

  // Tegnapi szkennelési diagnosztika
  const dt = await diagText(db).catch(() => null);
  if (dt) await notify(dt);

  // Adatforrás-teszt (ha fut): külön üzenetben
  try {
    const { rows } = await db.pool.query(`select * from probe_results order by created_at`);
    if (rows.length) {
      const { probeSummary, probeTelegram } = await import('./probe/report.js');
      await notify(probeTelegram(probeSummary(rows)));
    }
  } catch (e) {
    if (!/probe_results/.test(e.message)) log('Probe-riport hiba:', e.message);
  }
}

/** Egy kör: mindig szkennel; elszámol, ha letelt SETTLE_INTERVAL_MIN; riportot küld naponta egyszer 9:00 után. */
/** Napi eredményposzt a nyilvános csatornába (az előző budapesti nap kiküldött tippjei). */
async function publicDailyOnce({ db, publicNotify }) {
  const { start, end, label } = yesterdayRange();
  const rows = await db.publicSignalsBetween(start, end);
  if (!rows.length) { log('Nyilvános napi poszt: tegnap nem volt kiküldött tipp.'); return; }
  const { overall } = await db.report(30);
  await publicNotify(formatDailyResults(rows, overall, { dayLabel: label }));
  log(`Nyilvános napi poszt elküldve (${rows.length} tipp).`);
}

async function tick({ api, db, notify, publicNotify }) {
  const budget = await loadBudget(db);
  if (cfg.sports.includes('auto') && (await discoveryDue(db, cfg.discoverEveryDays))) {
    const left = cfg.dailyCreditBudget ? cfg.dailyCreditBudget - budget.used : cfg.discoverMaxCredits;
    if (left >= 20) {
      await discoverOnce({ api, db, cfg, log, notify, budget, maxCredits: Math.min(cfg.discoverMaxCredits, left), groups: cfg.discoverGroups, top: cfg.discoverTop })
        .catch((e) => log('Feltérképezési hiba:', e.message));
      await budget.save();
    }
  }
  await scanOnce({ api, db, notify, publicNotify, budget }).catch(async (e) => {
    log('Szkennelési hiba:', e.message);
    const last = Number(await db.getState('last_scan_error_alert')) || 0;
    if (Date.now() - last > 6 * 3600e3) {
      await notify(`⚠️ <b>Szkennelési hiba</b>: ${String(e.message).replace(/[&<>]/g, '')}\nA szkenner ilyenkor nem keres jelzést – szólj, és megnézzük.`);
      await db.setState('last_scan_error_alert', String(Date.now()));
    }
  });

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
  if (publicNotify && time >= `${cfg.publicDailyAt}:00` && (await db.getState('last_public_daily')) !== day) {
    // Előtte elszámolunk, hogy a tegnapi meccsek eredménye biztosan meglegyen.
    await settleOnce({ api, db, budget }).catch((e) => log('Elszámolási hiba:', e.message));
    await budget.save();
    await publicDailyOnce({ db, publicNotify }).catch((e) => log('Nyilvános napi poszt hiba:', e.message));
    await db.setState('last_public_daily', day);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const db = makeDb(cfg.databaseUrl);
  // Biztonsági zár: ha a privát és a nyilvános csatorna ugyanaz, a privát üzenetek (papír-jelzés, riportok)
  // NEM mennek ki oda, csak a naplóba – így előfizetők elé nem kerülhet belső tartalom.
  const sameChat = cfg.publicChatId && String(cfg.publicChatId) === String(cfg.telegramChatId);
  if (sameChat) log('⚠️ TELEGRAM_CHAT_ID = PUBLIC_CHAT_ID: a privát üzenetek csak a naplóba kerülnek. Adj meg külön privát csatornát (pl. a saját Telegram-azonosítódat).');
  const notify = makeNotifier({ token: cfg.telegramToken, chatId: sameChat ? '' : cfg.telegramChatId, log });
  // Nyilvános (előfizetői) csatorna: csak ha meg van adva a PUBLIC_CHAT_ID
  const publicNotify = cfg.publicChatId ? makeNotifier({ token: cfg.publicBotToken, chatId: cfg.publicChatId, log }) : null;

  try {
    if (args.has('--migrate')) { await db.migrate(); log('Tábla kész.'); return; }
    if (args.has('--report')) { await reportOnce({ db, notify }); return; }

    const api = new OddsApi({ apiKey: cfg.oddsApiKey });
    await db.migrate();
    if (args.has('--once')) { await scanOnce({ api, db, notify }); return; }
    if (args.has('--settle')) { await settleOnce({ api, db }); return; }
    if (args.has('--discover')) {
      const budget = await loadBudget(db);
      await discoverOnce({ api, db, cfg, log, notify, budget, maxCredits: cfg.discoverMaxCredits, groups: cfg.discoverGroups, top: cfg.discoverTop });
      await budget.save();
      return;
    }

    // --tick: egy teljes kör (szkennelés + esedékes elszámolás + esedékes riport), majd kilép.
    // Ütemezőhöz (Render Cron Job, GitHub Actions) való; az állapotot az adatbázis tárolja.
    if (args.has('--tick')) { await tick({ api, db, notify, publicNotify }); return; }
    if (args.has('--public-daily')) { if (publicNotify) await publicDailyOnce({ db, publicNotify }); return; }

    // Folyamatos futás (Render Background Worker)
    log(`Indulás: ${cfg.sports.includes('auto') ? 'automatikus ligalista' : `${cfg.sports.length} sport`}, piacok: ${cfg.markets.join(',')}, ${cfg.scanIntervalMin} percenként.`);
    for (;;) {
      await tick({ api, db, notify, publicNotify }).catch((e) => log('Hiba a körben:', e.message));
      await new Promise((r) => setTimeout(r, cfg.scanIntervalMin * 60e3));
    }
  } finally {
    await db.end().catch(() => {});
  }
}

// Közvetlen futtatáskor indul; tesztből importálva csak a függvényeket adja.
export { tick, scanOnce };
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
