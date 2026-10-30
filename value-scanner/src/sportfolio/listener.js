// Sportfolio-figyelő (userbot): a saját Telegram-fiókoddal olvassa a Value-csatornákat
// (Value NonStop: surebet-formátum; Tippmix / TPro Value: OddsHub-formátum),
// minden jelzést kiértékel, és a botodon (vagy a Mentett üzenetekbe) küld egy tömör összefoglalót.
//
//   node --env-file=.env src/sportfolio/listener.js --login         egyszeri bejelentkezés -> TG_SESSION
//   node --env-file=.env src/sportfolio/listener.js --channels      csatornák listája (ID kiválasztásához)
//   node --env-file=.env src/sportfolio/listener.js --backfill 50   az utolsó 50 üzenet kiértékelése (csak konzol)
//   node --env-file=.env src/sportfolio/listener.js                 folyamatos figyelés

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { parseSignal } from './parse.js';
import { analyzeSignal, formatAnalysis } from './analyze.js';
import { makeNotifier } from '../telegram.js';
import { makeFollowUp } from './followup.js';
import { parseOddsHub, analyzeOddsHub, formatOddsHub, markEmphasis } from './oddshub.js';
import { improvedHeader } from '../alerts.js';

// Sor végi "# megjegyzés" levágása (egyes .env-betöltők nem teszik meg).
const env = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/\s+#.*$/, '').trim() : v]));
const args = process.argv.slice(2);
const log = (...a) => console.log(new Date().toLocaleTimeString('hu-HU'), ...a);
const LEVELS = { mehet: 0, ovatosan: 1, kihagy: 2 };

const opts = {
  minEdge: Number(env.SF_MIN_EDGE ?? 0.02),
  maxEdge: Number(env.SF_MAX_EDGE ?? 0.10),
  minMinutes: Number(env.SF_MIN_MINUTES ?? 5),
  hugeEdge: Number(env.SF_HUGE_EDGE ?? 0.20),
  hugeMaxUnits: Number(env.SF_HUGE_MAX_UNITS ?? 1),
  // Tét egységben: 1 egység = a bankroll SF_UNIT_PCT %-a; tört Kelly, felső korláttal.
  stake: {
    kellyFraction: Number(env.SF_KELLY_FRACTION ?? 0.25),
    maxUnits: Number(env.SF_MAX_UNITS ?? 3),
    unitPct: Number(env.SF_UNIT_PCT ?? 1),
  },
};
// mehet = csak a tiszta jelzések; ovatosan = + figyelmeztetésesek (alap); kihagy = minden
const notifyLevel = LEVELS[env.SF_NOTIFY_LEVEL ?? 'ovatosan'] ?? 1;
// Követő értesítés: 🔔 javult az odds (ismétlésnél)
const followOpts = {
  improveDelta: Number(env.SF_IMPROVE_DELTA ?? 0.02),
  improveMax: Number(env.SF_IMPROVE_MAX ?? 2),
  windowMin: 20,
};

function makeClient(session = env.TG_SESSION ?? '') {
  if (!env.TG_API_ID || !env.TG_API_HASH) {
    console.error('Hiányzik a TG_API_ID / TG_API_HASH (my.telegram.org → API development tools).');
    process.exit(1);
  }
  const client = new TelegramClient(new StringSession(session), Number(env.TG_API_ID), env.TG_API_HASH, {
    connectionRetries: 5,
    retryDelay: 3000,
    autoReconnect: true,
  });
  client.setLogLevel('warn');
  return client;
}

async function login() {
  const rl = createInterface({ input: stdin, output: stdout });
  const client = makeClient('');
  await client.start({
    phoneNumber: () => rl.question('Telefonszám (pl. +36301234567): '),
    phoneCode: () => rl.question('A Telegramban kapott kód: '),
    password: () => rl.question('Kétlépcsős jelszó (ha van, különben Enter): '),
    onError: (e) => console.error('Hiba:', e.message),
  });
  rl.close();
  console.log('\n✅ Bejelentkezve. Másold be ezt a sort a .env fájlba (és senkinek ne add oda!):\n');
  console.log(`TG_SESSION=${client.session.save()}\n`);
  await client.disconnect();
  process.exit(0);
}

/** A figyelt csatornák: SPORTFOLIO_CHANNELS (vesszővel) vagy SPORTFOLIO_CHANNEL; ID vagy a név egy része. */
async function findChannels(client) {
  const wants = (env.SPORTFOLIO_CHANNELS || env.SPORTFOLIO_CHANNEL || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!wants.length) {
    console.error('Állítsd be a SPORTFOLIO_CHANNELS értékét (ID-k vagy a nevek egy része, vesszővel). Lista: --channels');
    process.exit(1);
  }
  const dialogs = await client.getDialogs({});
  const found = [];
  for (const want of wants) {
    const d = dialogs.find((x) => x.id?.toString() === want)
      ?? dialogs.find((x) => (x.title ?? '').toLowerCase().includes(want.toLowerCase()));
    if (!d) { log(`⚠️ Nem találom a csatornát: "${want}" (átnevezték? futtasd: --channels, és add meg az ID-ját)`); continue; }
    if (!found.some((f) => f.id?.toString() === d.id?.toString())) found.push(d);
  }
  if (!found.length) {
    console.error('Egyik megadott csatornát sem találom. Futtasd: --channels');
    process.exit(1);
  }
  return found;
}

async function makeDbIfAny() {
  if (!env.DATABASE_URL) return null;
  const { makeDb } = await import('../db.js');
  const db = makeDb(env.DATABASE_URL);
  await db.migrate();
  return db;
}

/** Bármelyik formátum: surebet (Value NonStop) vagy OddsHub (Tippmix / TPro Value). */
function evaluate(m) {
  const date = new Date(m.date * 1000);
  const sig = parseSignal(m.message, date);
  if (sig) return { kind: 'sf', sig, a: analyzeSignal(sig, { ...opts, now: date }) };
  const oh = parseOddsHub(markEmphasis(m.message, m.entities), date);
  if (oh) return { kind: 'oh', sig: oh, a: analyzeOddsHub(oh, { minEdge: opts.minEdge, hugeEdge: opts.hugeEdge, hugeMaxUnits: opts.hugeMaxUnits, now: date, stake: opts.stake }) };
  return null;
}

/** Az OddsHub-jelzés a követő (javulás/emlékeztető) számára érthető alakban */
const ohFollow = (sig, a) => ({
  sig: { home: sig.home, away: sig.away, startAt: sig.startAt, period: 'Match', sport: sig.sport, league: sig.league,
    value: { book: sig.soft.book, odds: a.softOdds } },
  a: { toBet: a.toBet, edge: a.edge, threshold: a.consThreshold ?? a.minOdds },
});

const render = (r, title) => (r.kind === 'sf' ? formatAnalysis(r.sig, r.a) : formatOddsHub(r.sig, r.a, { channel: title }));
const short = (r) => (r.kind === 'sf'
  ? `${r.a.verdict.padEnd(8)} ${r.sig.home} – ${r.sig.away} | ${r.a.toBet} | küszöb ${r.a.threshold.toFixed(2)} | előny ${(r.a.edge * 100).toFixed(1)}%`
  : `${r.a.verdict.padEnd(8)} ${r.sig.home} – ${r.sig.away} | ${r.a.toBet} @${r.a.softOdds ?? '?'} ${r.sig.soft.book} | előny ${r.a.edge == null ? '?' : (r.a.edge * 100).toFixed(1) + '%'}`);

async function main() {
  if (args.includes('--login')) return login();
  if (!env.TG_SESSION) {
    console.error('Nincs TG_SESSION. Először: --login');
    process.exit(1);
  }

  const client = makeClient();
  await client.connect();
  if (!(await client.checkAuthorization())) {
    console.error('A session lejárt vagy érvénytelen. Futtasd újra: --login');
    process.exit(1);
  }

  if (args.includes('--channels')) {
    const dialogs = await client.getDialogs({});
    for (const d of dialogs.filter((x) => x.isChannel || x.isGroup)) console.log(`${d.id?.toString().padEnd(16)} ${d.title}`);
    await client.disconnect();
    process.exit(0);
  }

  const channels = await findChannels(client);
  const db = await makeDbIfAny();
  // A csatornák saját (nyers) azonosítója -> cím. A GramJS chats-szűrője nem mindig tudja feloldani
  // az entitást, ezért minden új üzenetet megkapunk, és itt szűrünk.
  const byRawId = new Map(channels.map((c) => [c.entity?.id?.toString(), c.title]));

  const save = async (r, m, chId, title) => {
    if (!db) return;
    const p = r.kind === 'sf'
      ? db.insertSportfolio({ msgId: m.id, sig: r.sig, a: r.a })
      : db.insertOddsHub({ channelId: chId, channel: title, msgId: m.id, sig: r.sig, a: r.a });
    await p.catch((e) => log('DB-hiba:', e.message));
  };

  const bi = args.indexOf('--backfill');
  if (bi !== -1) {
    const limit = Number(args[bi + 1] ?? 50);
    for (const ch of channels) {
      const msgs = await client.getMessages(ch.entity, { limit });
      const count = { mehet: 0, ovatosan: 0, kihagy: 0, nem_jelzes: 0 };
      console.log(`\n===== ${ch.title} =====`);
      for (const m of [...msgs].reverse()) {
        const r = evaluate(m);
        if (!r) { count.nem_jelzes++; continue; }
        count[r.a.verdict]++;
        console.log(`\n#${m.id} ${new Date(m.date * 1000).toLocaleString('hu-HU')}\n${render(r, ch.title).replace(/<[^>]+>/g, '')}`);
        await save(r, m, ch.entity?.id?.toString(), ch.title);
      }
      console.log(`\nÖsszesítés (${ch.title}):`, count);
    }
    await client.disconnect();
    if (db) await db.end();
    process.exit(0);
  }

  // Értesítés: ha van bot token, a botodon keresztül; különben a saját "Mentett üzenetek"-be.
  const viaBot = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID;
  const notify = viaBot
    ? makeNotifier({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, log })
    : (text) => client.sendMessage('me', { message: text, parseMode: 'html' });

  const follow = makeFollowUp(followOpts);
  if (db) {
    try {
      follow.load((await db.sfPendingNotified(followOpts.windowMin)).map((r) => ({ ...r, msg_id: `sf:${r.msg_id}` })));
      follow.load((await db.ohPendingNotified(followOpts.windowMin)).map((r) => ({
        msg_id: `oh:${r.channel_id}:${r.msg_id}`, home: r.home, away: r.away, start_at: r.start_at, period: 'Match',
        sport: r.sport, league: r.league, value_book: r.soft_book, value_odds: r.value_odds, to_bet: r.to_bet,
        edge: r.edge, threshold: r.threshold ?? r.min_odds,
      })));
    } catch (e) { log('Követési adatok betöltése sikertelen:', e.message); }
  }

  client.addEventHandler(async (event) => {
    const m = event.message;
    const chId = m?.peerId?.channelId?.toString();
    if (!chId || !byRawId.has(chId)) return;
    const title = byRawId.get(chId);
    try {
      const r = evaluate(m);
      if (!r) return; // capper-tipp vagy egyéb üzenet
      log(`[${title}] ${short(r)}`);
      await save(r, m, chId, title);
      if (LEVELS[r.a.verdict] > notifyLevel) return;

      const f = r.kind === 'sf' ? { sig: r.sig, a: r.a } : ohFollow(r.sig, r.a);
      const d = follow.decide(f.sig, f.a);
      if (d.action === 'repeat') { log('  ↳ ismétlés (nem javult eléggé), nem küldöm újra'); return; }
      const text = render(r, title);
      await notify(d.action === 'improved' ? `${improvedHeader(d.prev, d.cur)}\n\n${text}` : text);
      const key = r.kind === 'sf' ? `sf:${m.id}` : `oh:${chId}:${m.id}`;
      follow.record(f.sig, f.a, key, d.action);
      if (db) {
        const p = r.kind === 'sf' ? db.markSfNotified(m.id) : db.markOhNotified(chId, m.id);
        await p.catch((e) => log('DB-hiba:', e.message));
      }
    } catch (e) {
      log('Feldolgozási hiba:', e.message);
    }
  }, new NewMessage({}));

  log(`Figyelés indul: ${channels.map((c) => `"${c.title}"`).join(', ')}. Értesítés: ${viaBot ? 'bot' : 'Mentett üzenetek'}. Leállítás: Ctrl+C`);

  // Őr (watchdog): ha a hálózat elmegy, a GramJS újracsatlakozása néha beragad.
  // Percenként ellenőrizzük a kapcsolatot; ha 3 percig nincs rendben, kilépünk
  // (1-es kóddal), és a start-figyelo.bat tiszta kapcsolattal újraindítja.
  const WATCH_MS = 60_000, MAX_FAILS = 3;
  let fails = 0;
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('időtúllépés')), ms))]);
  setInterval(async () => {
    try {
      if (!client.connected) throw new Error('nincs kapcsolat');
      await withTimeout(client.getMe(), 20_000);
      if (fails) log('Kapcsolat helyreállt.');
      fails = 0;
    } catch (e) {
      fails++;
      log(`Kapcsolat-ellenőrzés sikertelen (${fails}/${MAX_FAILS}): ${e.message}`);
      if (fails >= MAX_FAILS) {
        log('A kapcsolat nem állt helyre – kilépés, újraindítás következik.');
        process.exit(1);
      }
    }
  }, WATCH_MS);
  const stop = async () => { log('Leállás...'); await client.disconnect(); if (db) await db.end(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
