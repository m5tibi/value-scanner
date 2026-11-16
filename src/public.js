// Nyilvános (előfizetői) csatorna: „Mondom a Tutit! · Value” – a szkenner jelzései előfizetőknek szánt formában,
// és napi eredményposzt. Irodát nem nevez meg; a tétet egységben adja (negyed-Kelly), az eredményt 1 egységes tétekkel számolja.

import { describeSelection } from './markets.js';
import { sportHu, untilHu } from './format.js';
import { stakeUnits } from './sportfolio/analyze.js';

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const u = (x) => String(x).replace('.', ',');
const pct = (x, sign = false) => (x === null || x === undefined ? '–' : `${sign && x > 0 ? '+' : ''}${(x * 100).toFixed(1).replace('.', ',')}%`);

const BRAND = 'Mondom a Tutit! · Value';
const EMOJI = { soccer: '⚽', basketball: '🏀', icehockey: '🏒', handball: '🤾', tennis: '🎾', americanfootball: '🏈', baseball: '⚾' };
export const sportEmoji = (key) => EMOJI[String(key ?? '').split('_')[0]] ?? '🎯';

/** Liga neve: a feltérképezésből (pl. "Superettan"), különben a kulcsból ("soccer_sweden_superettan" -> "Sweden Superettan"). */
export function leagueName(key, titles = {}) {
  if (titles[key]) return titles[key];
  return String(key ?? '').split('_').slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || key;
}

/** Javasolt tét egységben: negyed-Kelly a fair esély és a jelzett odds alapján, legalább 0,25 egység. */
export function publicStake(s, { kellyFraction = 0.25, maxUnits = 3, unitPct = 1 } = {}) {
  const p = Number(s.fair_prob) || 1 / Number(s.fair_odds);
  return Math.max(0.25, stakeUnits(p, Number(s.soft_odds), { kellyFraction, maxUnits, unitPct }));
}

const startText = (t) => new Date(t).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Előfizetői jelzés (HTML). */
export function formatPublicSignal(s, { id, titles, stake = {}, improvedFrom } = {}) {
  const minutes = Math.round((new Date(s.commence_time) - Date.now()) / 60000);
  const units = publicStake(s, stake);
  const lines = [];
  if (improvedFrom) lines.push(`🔔 <b>Jobb odds érhető el</b> (eddig ${improvedFrom})`, '');
  lines.push(
    `💎 <b>${BRAND}</b>${id ? ` · #${id}` : ''}`,
    `${sportEmoji(s.sport_key)} ${esc(sportHu(s.sport_key))} · ${esc(leagueName(s.sport_key, titles))}`,
    `<code>${esc(s.home_team)}</code> – <code>${esc(s.away_team)}</code>`,
    `🕒 ${startText(s.commence_time)}${untilHu(minutes)}`,
    ``,
    `👉 <b>${esc(describeSelection({ market: s.market, name: s.outcome_name, point: s.point == null ? undefined : Number(s.point) }, s))}</b>`,
    `Odds most: <b>${Number(s.soft_odds).toFixed(2)}</b> · fair: ${Number(s.fair_odds).toFixed(2)} · előny: <b>${pct(Number(s.edge), true)}</b>`,
    `✅ Csak akkor, ha az odds <b>≥ ${Number(s.min_odds).toFixed(2)}</b>`,
    `💰 Tét: <b>${u(units)} egység</b> <i>(1 egység = a bankroll ${u(stake.unitPct ?? 1)}%-a)</i>`,
    ``,
    `<i>Value-tipp: hosszú távon nyer, nem minden egyes fogadáson. 18+ · Játssz felelősen.</i>`,
  );
  return lines.join('\n');
}

const RESULT_ICON = { nyert: '✅', fel_nyert: '✅', vesztett: '❌', fel_vesztett: '❌', 'visszajár': '↩️' };
const RESULT_HU = { nyert: 'nyert', fel_nyert: 'félig nyert', vesztett: 'vesztett', fel_vesztett: 'félig vesztett', 'visszajár': 'visszajár' };

/**
 * Napi eredményposzt.
 * rows: az adott nap (budapesti idő) nyilvánosan kiküldött jelzései; stats: db.report(30).overall
 */
export function formatDailyResults(rows, stats, { dayLabel } = {}) {
  const settled = rows.filter((r) => r.result);
  const open = rows.length - settled.length;
  const won = settled.filter((r) => /nyert/.test(r.result)).length;
  const lost = settled.filter((r) => /vesztett/.test(r.result)).length;
  const profit = settled.reduce((a, r) => a + Number(r.profit ?? 0), 0);
  const list = settled.slice(0, 30).map((r) => {
    const sel = describeSelection({ market: r.market, name: r.outcome_name, point: r.point == null ? undefined : Number(r.point) }, r);
    const score = r.home_score != null ? ` (${r.home_score}–${r.away_score})` : '';
    return `${RESULT_ICON[r.result] ?? '•'} ${r.public_no ? `#${r.public_no} ` : ''}${esc(r.home_team)} – ${esc(r.away_team)} · ${esc(sel)} @${Number(r.soft_odds).toFixed(2)} → ${RESULT_HU[r.result] ?? r.result}${score}`;
  });
  const out = [
    `📊 <b>${BRAND} – ${esc(dayLabel ?? 'tegnapi')} eredmények</b>`,
    ``,
    ...list,
  ];
  if (settled.length > 30) out.push(`… és még ${settled.length - 30} tipp`);
  out.push(
    ``,
    `Napi mérleg: <b>${won} nyert / ${lost} vesztett</b>${open ? ` · ${open} még nincs elszámolva` : ''}`,
    `Profit: <b>${profit >= 0 ? '+' : ''}${u(profit.toFixed(2))} egység</b> <i>(1 egységes tétekkel)</i>`,
  );
  if (stats && stats.elszamolt) {
    out.push(
      ``,
      `📈 <b>Utolsó 30 nap</b> (a rendszer összes jelzése)`,
      `${stats.elszamolt} tipp · profit ${stats.profit >= 0 ? '+' : ''}${u(Number(stats.profit).toFixed(2))} egység · ROI ${pct(stats.profit / stats.elszamolt, true)}`,
      `CLV: <b>${pct(stats.atlag_clv, true)}</b> · pozitív CLV: ${pct(stats.pozitiv_clv_arany)}`,
      `<i>A CLV azt méri, mennyivel kaptunk jobb oddsot a meccs előtti végső piaci árnál. Ha tartósan pozitív, a tippek valódi előnyt hordoznak – rövid távon a profit ettől még ingadozik.</i>`,
    );
  }
  return out.join('\n');
}

/** Az előző budapesti nap [kezdet, vég) időpontjai és címkéje (pl. "november 8-i"). */
export function yesterdayRange(now = new Date()) {
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' }); // YYYY-MM-DD
  const [y, m, d] = today.split('-').map(Number);
  const mid = (Y, M, D) => {
    // budapesti éjfél UTC-ben (téli/nyári idő kezelve)
    const guess = Date.UTC(Y, M - 1, D);
    const wall = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'Europe/Budapest' }));
    const utc = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }));
    return new Date(guess - (wall - utc));
  };
  const end = mid(y, m, d);
  const start = new Date(end.getTime() - 24 * 3600e3 + 12 * 3600e3); // átállás-biztos: dél, majd vissza éjfélre
  const sDay = start.toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' }).split('-').map(Number);
  const realStart = mid(sDay[0], sDay[1], sDay[2]);
  const label = realStart.toLocaleDateString('hu-HU', { timeZone: 'Europe/Budapest', month: 'long', day: 'numeric' }).replace(/\.$/, '') + '-i';
  return { start: realStart, end, label };
}
