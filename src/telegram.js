// Telegram-értesítés (Bot API, sima fetch). Token nélkül konzolra ír.

import { describeSelection } from './markets.js';
import { sportHu, untilHu } from './format.js';

const BOOK_NAMES = { onexbet: '1xBet', marathonbet: 'Marathon', pinnacle: 'Pinnacle' };
export const bookName = (k) => BOOK_NAMES[k] ?? k;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function formatSignal(s) {
  const start = new Date(s.commence_time).toLocaleString('hu-HU', {
    timeZone: 'Europe/Budapest', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  return [
    `🎯 <b>Value (papír)</b> — ${esc(sportHu(s.sport_key))} · <code>${esc(s.sport_key)}</code>`,
    `<code>${esc(s.home_team)}</code> – <code>${esc(s.away_team)}</code>`,
    `🕒 ${start}${untilHu(s.minutes_to_start)}`,
    ``,
    `👉 <b>${esc(describeSelection({ market: s.market, name: s.outcome_name, point: s.point }, s))}</b>`,
    `${bookName(s.soft_book)}: <b>${s.soft_odds}</b>  |  fair: ${s.fair_odds}  |  előny: <b>${(s.edge * 100).toFixed(1)}%</b>`,
    `Pinnacle: ${s.pin_odds} (árrés ${(s.pin_margin * 100).toFixed(1)}%)`,
    ``,
    `✅ Saját irodánál akkor éri meg, ha az odds <b>≥ ${s.min_odds}</b>`,
  ].join('\n');
}

/**
 * Telegram-értesítő újrapróbálkozással: hálózati hiba, 429 (túl sok kérés) vagy 5xx esetén
 * legfeljebb 3-szor próbálja újra (2 s, 5 s, 10 s várakozással; 429-nél a Telegram retry_after értékével).
 */
export function makeNotifier({ token, chatId, fetchImpl = fetch, log = console.log, delays = [2000, 5000, 10000], sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!token || !chatId) {
    return async (text) => log(`[TELEGRAM KIKAPCSOLVA]\n${text.replace(/<[^>]+>/g, '')}\n`);
  }
  return async (text) => {
    for (let attempt = 0; ; attempt++) {
      let retryAfterMs = null, why;
      try {
        const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        });
        if (res.ok) return true;
        const body = (await res.text()).slice(0, 200);
        if (res.status !== 429 && res.status < 500) { log(`Telegram hiba ${res.status}: ${body}`); return false; } // pl. hibás HTML: nincs értelme újra
        try { retryAfterMs = (JSON.parse(body)?.parameters?.retry_after ?? 0) * 1000 || null; } catch { /* nem JSON */ }
        why = `HTTP ${res.status}`;
      } catch (e) {
        why = e.message; // pl. "fetch failed" (hálózati hiba)
      }
      if (attempt >= delays.length) { log(`Telegram: nem sikerült elküldeni ${attempt + 1} próbálkozás után (${why})`); return false; }
      const wait = retryAfterMs ?? delays[attempt];
      log(`Telegram: ${why} – újrapróbálom ${Math.round(wait / 1000)} mp múlva (${attempt + 1}/${delays.length})`);
      await sleep(wait);
    }
  };
}
