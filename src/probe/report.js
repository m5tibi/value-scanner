// Adatforrás-teszt összesítése:  node --env-file=.env src/probe/report.js   (npm run probe:report)
// Csak az adatbázist olvassa (Telegramhoz nem nyúl), így a saját gépen is futtatható, miközben a figyelő a Renderen megy.

import pg from 'pg';

const env = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/\s+#.*$/, '').trim() : v]));
if (!env.DATABASE_URL) { console.error('Nincs DATABASE_URL'); process.exit(1); }
const ssl = /localhost|127\.0\.0\.1/.test(env.DATABASE_URL) ? false : { rejectUnauthorized: false };
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl });

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');

const { rows } = await pool.query(`select * from probe_results order by created_at`);
if (!rows.length) { console.log('Még nincs teszteredmény.'); process.exit(0); }

console.log(`Teszteredmények: ${rows.length} sor (${rows[0].created_at.toLocaleString('hu-HU')} – ${rows.at(-1).created_at.toLocaleString('hu-HU')})\n`);

for (const provider of ['pinnapi', 'oddspapi']) {
  const rs = rows.filter((r) => r.provider === provider);
  if (!rs.length) continue;
  const ok = rs.filter((r) => !r.error || r.found);
  const found = rs.filter((r) => r.found);
  console.log(`=== ${provider} ===`);
  console.log(`  Lekérdezett jelzés: ${rs.length} · hiba: ${rs.filter((r) => r.error).length}`);
  console.log(`  Meccs megtalálva: ${found.length}/${ok.length} (${pct(found.length, ok.length)})`);
  const pinChecked = found.filter((r) => r.pin_match !== null);
  console.log(`  Pinnacle-ár egyezik a jelzéssel: ${pinChecked.filter((r) => r.pin_match).length}/${pinChecked.length} (${pct(pinChecked.filter((r) => r.pin_match).length, pinChecked.length)})`);
  if (provider === 'oddspapi') {
    const sf = found.filter((r) => r.soft_found !== null);
    console.log(`  TippmixPro a meccsnél: ${sf.filter((r) => r.soft_found).length}/${sf.length} (${pct(sf.filter((r) => r.soft_found).length, sf.length)})`);
    const sm = found.filter((r) => r.soft_found);
    console.log(`  TippmixPro-ár egyezik a jelzéssel: ${sm.filter((r) => r.soft_match).length}/${sm.length} (${pct(sm.filter((r) => r.soft_match).length, sm.length)})`);
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
await pool.end();
