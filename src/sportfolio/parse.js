// A Sportfolio "Value NonStop" (BetBurger surebet) üzenetek feldolgozása.
//
// Példa:
//   💰 New surebet found!
//   Profit: 4.15%
//   Sport: Basketball
//   League: World. Friendly Clubs
//   Event: Barangay Ginebra San Miguel - Blackwater Elite Bossing [Full time with overtimes]
//   Start at : 23 Oct 11:30 UTC
//
//   Winlinebet:
//   ▫️TO(217.5) → 2.4
//   ▫️Stake: 43.4 $ Place Bet
//   Pinnacle:
//   ▫️TU(217.5) → 1.84
//   ▫️Stake: 56.6 $ Place Bet

export const SHARP_BOOKS = new Set(['Pinnacle', 'BetinAsia']);

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** "23 Oct 11:30 UTC" -> Date. Évet a feladás idejéből vesszük (év végi átfordulással). */
export function parseStart(s, postedAt = new Date()) {
  const m = /(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{1,2}):(\d{2})/.exec(s ?? '');
  if (!m || !(m[2] in MONTHS)) return null;
  const y = postedAt.getUTCFullYear();
  let d = new Date(Date.UTC(y, MONTHS[m[2]], +m[1], +m[3], +m[4]));
  // pl. december végén feladott, januári kezdésű meccs
  if (d.getTime() - postedAt.getTime() < -180 * 864e5) d = new Date(Date.UTC(y + 1, MONTHS[m[2]], +m[1], +m[3], +m[4]));
  return d;
}

/**
 * @param {string} text  az üzenet nyers szövege
 * @param {Date} postedAt
 * @returns {null | object}  null, ha nem surebet-jelzés vagy nem értelmezhető
 */
export function parseSignal(text, postedAt = new Date()) {
  if (!text || !/New surebet found/i.test(text)) return null;
  const t = text.replace(/\r/g, '').replace(/`/g, '');
  const get = (re) => re.exec(t)?.[1]?.trim() ?? null;

  const ev = /Event:\s*(.+?)\s+-\s+(.+?)\s*\[(.+?)\]/.exec(t);
  // "Bookmaker:" sor, alatta "▫️<piac> → <odds>"
  const legs = [...t.matchAll(/^\s*([A-Za-z0-9][\w .'&-]*?):\s*\n\W*?([^\n→]+?)\s*→\s*([\d.]+)/gm)]
    .map((m) => ({ book: m[1].trim(), market: m[2].replace(/^[^A-Za-z0-9]+/u, '').trim(), odds: Number(m[3]) }))
    .filter((l) => !['Profit', 'Sport', 'League', 'Event', 'Start at'].includes(l.book));
  if (!ev || legs.length !== 2 || legs.some((l) => !(l.odds > 1))) return null;

  const sharp = legs.filter((l) => SHARP_BOOKS.has(l.book));
  if (sharp.length !== 1) return null; // nincs (vagy két) referencia-iroda -> nem tudjuk értékelni
  // Megjegyzés: a "Stake" itt irodanév is lehet (Stake.com); a "▫️Stake: 46.1 $" sorok nem végződnek
  // kettősponttal, ezért nem keverednek a lábakkal.
  const ref = sharp[0];
  const value = legs.find((l) => l !== ref);

  const startRaw = get(/Start at\s*:\s*(.+)/);
  return {
    profit: Number(get(/Profit:\s*([\d.]+)/)),
    sport: get(/Sport:\s*(.+)/),
    league: get(/League:\s*(.+)/),
    home: ev[1].trim(),
    away: ev[2].trim(),
    period: ev[3].trim(),
    startAt: parseStart(startRaw, postedAt),
    postedAt,
    value, // ezt kell megtenni (nem-Pinnacle láb)
    ref,   // Pinnacle / BetinAsia: csak referencia
  };
}
