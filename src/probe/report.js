// Adatforrás-teszt összesítése.
//   node src/probe/report.js              -> kiírja (Render Shell / saját gép: npm run probe:report)
//   node src/probe/report.js --telegram   -> elküldi a Telegram-botodon is
// Csak az adatbázist olvassa; a szkenner napi riportja is elküldi (index.js).

import pg from 'pg';
import { pathToFileURL } from 'node:url';

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');

export function probeSummary(rows) {
const out = [];
const console = { log: (x = '') => out.push(x) };
if (!rows.length) return 'Még nincs teszteredmény.';

console.log(`Teszteredmények: ${rows.length} sor (${rows[0].created_at.toLocaleString('hu-HU')} – ${rows.at(-1).created_at.toLocaleString('hu-HU')})\n`);

const KINDS = { oh: 'OddsHub (TPro/Tippmix)', sf: 'Value NonStop' };
const kindOf = (r) => (String(r.market ?? '').startsWith('sf:') ? 'sf' : 'oh');
for (const provider of ['pinnapi', 'oddspapi']) for (const kind of ['oh', 'sf']) {
  const rs = rows.filter((r) => r.provider === provider && kindOf(r) === kind);
  if (!rs.length) continue;
  const ok = rs.filter((r) => !r.error || r.found);
  const found = rs.filter((r) => r.found);
  console.log(`=== ${provider} · ${KINDS[kind]} ===`);
  console.log(`  Lekérdezett jelzés: ${rs.length} · hiba: ${rs.filter((r) => r.error).length}`);
  console.log(`  Meccs megtalálva: ${found.length}/${ok.length} (${pct(found.length, ok.length)})`);
  const pinChecked = found.filter((r) => r.pin_match !== null);
  console.log(`  Pinnacle-ár egyezik a jelzéssel: ${pinChecked.filter((r) => r.pin_match).length}/${pinChecked.length} (${pct(pinChecked.filter((r) => r.pin_match).length, pinChecked.length)})`);
  if (provider === 'oddspapi') {
    // Soft irodánként: megvan-e a meccsnél, és egyezik-e az ár
    const byBook = new Map();
    for (const r of found) {
      const b = byBook.get(r.soft_book) ?? { n: 0, present: 0, match: 0 };
      b.n++; if (r.soft_found) b.present++; if (r.soft_match) b.match++;
      byBook.set(r.soft_book, b);
    }
    for (const [book, b] of [...byBook].sort((x, y) => y[1].n - x[1].n)) {
      console.log(`  ${book}: a meccsnél ${b.present}/${b.n}, ugyanaz az ár ${b.match}/${b.present || 0}`);
    }
    const books = new Map();
    for (const r of found) for (const b of r.bookmakers ?? []) books.set(b, (books.get(b) ?? 0) + 1);
    if (books.size) console.log(`  Irodák a válaszokban: ${[...books].map(([b, n]) => `${b} (${n})`).join(', ')}`);
  }
  // Sportáganként
  const bySport = new Map();
  for (const r of ok) {
    const s = bySport.get(r.sport) ?? { n: 0, f: 0 };
    s.n++; if (r.found) s.f++;
    bySport.set(r.sport, s);
  }
  console.log(`  Sportáganként (megtalálva): ${[...bySport].map(([s, x]) => `${s} ${x.f}/${x.n}`).join(' · ')}`);
  const misses = ok.filter((r) => !r.found).slice(-8);
  if (misses.length) console.log(`  Nem talált (utolsók): ${misses.map((r) => `${r.home} – ${r.away} (${r.league})`).join('; ')}`);
  const errs = [...new Set(rs.filter((r) => r.error).map((r) => r.error))].slice(0, 3);
  if (errs.length) console.log(`  Hibák: ${errs.join(' | ')}`);
  console.log('');
}
return out.join('\n').trimEnd();
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
/** Telegram-üzenet (HTML) a riportból; a 4096 karakteres korlát miatt vágva. */
export function probeTelegram(text) {
  const t = text.length > 3800 ? `${text.slice(0, 3800)}\n…` : text;
  return `🔎 <b>Adatforrás-teszt</b> (pinnapi / OddsPapi)\n<pre>${esc(t)}</pre>`;
}

async function cli() {
  const env = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/\s+#.*$/, '').trim() : v]));
  if (!env.DATABASE_URL) { console.error('Nincs DATABASE_URL (a Render Shellben a szolgáltatás változói elérhetők; saját gépen: npm run probe:report)'); process.exit(1); }
  console.log('Adatbázis lekérdezése…');
  const ssl = /localhost|127\.0\.0\.1/.test(env.DATABASE_URL) ? false : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl, connectionTimeoutMillis: 20_000 });
  const timer = setTimeout(() => { console.error('Nincs válasz az adatbázistól 30 mp alatt – ellenőrizd a DATABASE_URL-t.'); process.exit(1); }, 30_000);
  try {
    const { rows } = await pool.query(`select * from probe_results order by created_at`);
    const text = probeSummary(rows);
    console.log(text);
    if (process.argv.includes('--telegram') && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      const { makeNotifier } = await import('../telegram.js');
      await makeNotifier({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID })(probeTelegram(text));
      console.log('Elküldve Telegramon.');
    }
  } catch (e) {
    console.error('Hiba:', e.message);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await pool.end().catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await cli();
