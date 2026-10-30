// Követő értesítések, közösen a szkennerhez és a Sportfolio-figyelőhöz:
//   🔔 "Javult az odds"  – ugyanarra a kimenetelre jobb ár ÉS nagyobb előny jött (kezdés előtt)
//   ⏰ "Már megy a meccs" – emlékeztető kezdéskor a kiküldött jelzésekről (nem kér le semmit, ingyenes)
// Tiszta függvények, hálózat és adatbázis nélkül.

import { sportHu } from './format.js';

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const hhmm = (d) => new Date(d).toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit' });

/**
 * Akkor "javult", ha az odds magasabb, az előny (friss referenciából számolva) legalább minDelta-val nőtt,
 * és erre a kimenetelre még nem küldtünk maxCount-nál több javulást.
 * prev/cur: { odds, edge, count? }
 */
export function isImprovement(prev, cur, { minDelta = 0.02, maxCount = 2 } = {}) {
  if (!prev || prev.odds == null || prev.edge == null) return false;
  return (prev.count ?? 0) < maxCount && Number(cur.odds) > Number(prev.odds) && Number(cur.edge) >= Number(prev.edge) + minDelta;
}

/** Fejléc a javulás-üzenet elejére. */
export function improvedHeader(prev, cur) {
  return `🔔 <b>Javult az odds</b>: ${esc(prev.book ?? '')} ${prev.odds} (${pct(Number(prev.edge))}) → ` +
    `<b>${esc(cur.book ?? '')} ${cur.odds}</b> (<b>${pct(Number(cur.edge))}</b>)`;
}

/**
 * Kezdési emlékeztető egy meccsre (a meccs összes kiküldött jelzésével).
 * m: { home, away, sport, league?, startAt, items: [{ toBet, book, odds, threshold }] }
 */
export function formatLiveReminder(m) {
  const sportLine = [esc(sportHu(m.sport)), m.league ? `<code>${esc(m.league)}</code>` : null].filter(Boolean).join(' · ');
  return [
    `⏰ <b>Elkezdődött – nézz rá élőben</b>`,
    `<code>${esc(m.home)}</code> – <code>${esc(m.away)}</code>`,
    `${sportLine} · kezdés ${hhmm(m.startAt)}`,
    ``,
    `Kezdés előtti jelzés${m.items.length > 1 ? 'ek' : ''}:`,
    ...m.items.map((i) => `• <b>${esc(i.toBet)}</b> — ${esc(i.book)} ${i.odds}` + (i.threshold ? ` (küszöb ≥ ${Number(i.threshold).toFixed(2)})` : '')),
    ``,
    `ℹ️ Élőben a küszöb már nem érvényes: a magasabb odds általában azt jelzi, hogy a meccs a fogadás ellen alakul.`,
  ].join('\n');
}

/**
 * Melyik emlékeztető esedékes: a kezdés már elmúlt, de legfeljebb windowMin perce
 * (a régebbieket csendben eldobjuk, pl. ha a gép ki volt kapcsolva).
 */
export function splitDue(matches, now = new Date(), windowMin = 20) {
  const due = [], expired = [];
  for (const m of matches) {
    const t = new Date(m.startAt).getTime();
    if (t > now.getTime()) continue;
    (now.getTime() - t <= windowMin * 60e3 ? due : expired).push(m);
  }
  return { due, expired };
}

/** Sorok (egy jelzés = egy sor) csoportosítása meccsenként. */
export function groupByMatch(rows, keyOf, toMatch, toItem) {
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!map.has(k)) map.set(k, { ...toMatch(r), items: [], ids: [] });
    const m = map.get(k);
    m.items.push(toItem(r));
    m.ids.push(r.id ?? r.msg_id);
  }
  return [...map.values()];
}
