// Sportfolio-figyelő (userbot): a saját Telegram-fiókoddal olvassa a Value-csatornát,
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

async function findChannel(client) {
  const want = env.SPORTFOLIO_CHANNEL;
  if (!want) {
    console.error('Állítsd be a SPORTFOLIO_CHANNEL értékét (ID vagy a név egy része). Lista: --channels');
    process.exit(1);
  }
  const dialogs = await client.getDialogs({});
  const d = dialogs.find((x) => x.id?.toString() === want)
    ?? dialogs.find((x) => (x.title ?? '').toLowerCase().includes(want.toLowerCase()));
  if (!d) {
    console.error(`Nem találom a csatornát: "${want}". Futtasd: --channels`);
    process.exit(1);
  }
  return d;
}

async function makeDbIfAny() {
  if (!env.DATABASE_URL) return null;
  const { makeDb } = await import('../db.js');
  const db = makeDb(env.DATABASE_URL);
  await db.migrate();
  return db;
}

function evaluate(text, date) {
  const sig = parseSignal(text, date);
  if (!sig) return null;
  const a = analyzeSignal(sig, { ...opts, now: date });
  return { sig, a };
}

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

  const channel = await findChannel(client);
  const db = await makeDbIfAny();

  const bi = args.indexOf('--backfill');
  if (bi !== -1) {
    const limit = Number(args[bi + 1] ?? 50);
    const msgs = await client.getMessages(channel.entity, { limit });
    const count = { mehet: 0, ovatosan: 0, kihagy: 0, nem_jelzes: 0 };
    for (const m of [...msgs].reverse()) {
      const r = evaluate(m.message, new Date(m.date * 1000));
      if (!r) { count.nem_jelzes++; continue; }
      count[r.a.verdict]++;
      console.log(`\n#${m.id} ${new Date(m.date * 1000).toLocaleString('hu-HU')}\n${formatAnalysis(r.sig, r.a).replace(/<[^>]+>/g, '')}`);
      if (db) await db.insertSportfolio({ msgId: m.id, ...r });
    }
    console.log('\nÖsszesítés:', count);
    await client.disconnect();
    if (db) await db.end();
    process.exit(0);
  }

  // Értesítés: ha van bot token, a botodon keresztül; különben a saját "Mentett üzenetek"-be.
  const viaBot = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID;
  const notify = viaBot
    ? makeNotifier({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, log })
    : (text) => client.sendMessage('me', { message: text, parseMode: 'html' });

  // A csatorna saját (nyers) azonosítója. A GramJS chats-szűrője ebben a verzióban nem mindig
  // tudja feloldani az entitást, ezért minden új üzenetet megkapunk, és itt szűrünk.
  const channelRawId = channel.entity?.id?.toString();
  const isOurChannel = (m) => m?.peerId?.channelId?.toString() === channelRawId;

  client.addEventHandler(async (event) => {
    const m = event.message;
    if (!isOurChannel(m)) return;
    try {
      const r = evaluate(m.message, new Date(m.date * 1000));
      if (!r) return; // capper-tipp vagy egyéb üzenet
      const { sig, a } = r;
      log(`${a.verdict.padEnd(8)} ${sig.home} – ${sig.away} | ${a.toBet} | küszöb ${a.threshold.toFixed(2)} | előny ${(a.edge * 100).toFixed(1)}%`);
      if (db) await db.insertSportfolio({ msgId: m.id, sig, a }).catch((e) => log('DB-hiba:', e.message));
      if (LEVELS[a.verdict] <= notifyLevel) await notify(formatAnalysis(sig, a));
    } catch (e) {
      log('Feldolgozási hiba:', e.message);
    }
  }, new NewMessage({}));

  log(`Figyelés indul: "${channel.title}". Értesítés: ${viaBot ? 'bot' : 'Mentett üzenetek'}. Leállítás: Ctrl+C`);

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
