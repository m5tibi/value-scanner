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

export function makeNotifier({ token, chatId, fetchImpl = fetch, log = console.log }) {
  if (!token || !chatId) {
    return async (text) => log(`[TELEGRAM KIKAPCSOLVA]\n${text.replace(/<[^>]+>/g, '')}\n`);
  }
  return async (text) => {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) log(`Telegram hiba ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
}
