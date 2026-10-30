// Value-keresés: a soft irodák oddsait a Pinnacle árrésmentes (fair) valószínűségéhez mérjük.
// Tiszta függvények, hálózat és adatbázis nélkül -> könnyen tesztelhető.

import { devig, margin } from './devig.js';
import { groupOutcomes } from './markets.js';

const ageSec = (iso, now) => (iso ? (now.getTime() - Date.parse(iso)) / 1000 : Infinity);

function marketsOf(bookmaker) {
  const m = new Map();
  for (const mk of bookmaker.markets ?? []) {
    m.set(mk.key, { ...mk, last_update: mk.last_update ?? bookmaker.last_update });
  }
  return m;
}

/**
 * @returns {{ signals: object[], sharpSnapshots: object[], rejected: Record<string, number>, stats: object }}
 *  - signals: szűrőkön átment value-jelzések
 *  - sharpSnapshots: minden friss Pinnacle-csoport fair valószínűségei (a CLV frissítéséhez)
 *  - rejected: hány jelölt esett ki melyik szűrőn (hangoláshoz)
 */
export function scanEvents(events, cfg, now = new Date()) {
  const signals = [];
  const sharpSnapshots = [];
  const rejected = {};
  const reject = (why) => { rejected[why] = (rejected[why] ?? 0) + 1; };
  // Diagnosztika: hány meccset/kimenetelt vizsgált, és mi volt a legjobb (akár küszöb alatti) előny.
  const stats = { events: 0, withSharp: 0, compared: 0, positive: 0, best: null };

  for (const ev of events) {
    const minutesToStart = (Date.parse(ev.commence_time) - now.getTime()) / 60000;
    if (minutesToStart <= 0) continue; // élő meccs: nem foglalkozunk vele
    stats.events++;

    const sharp = ev.bookmakers?.find((b) => b.key === cfg.sharpBook);
    if (!sharp) continue;
    stats.withSharp++;
    const sharpMarkets = marketsOf(sharp);

    for (const [mkKey, sharpMk] of sharpMarkets) {
      if (ageSec(sharpMk.last_update, now) > cfg.maxStalenessSec) { reject('pinnacle_elavult'); continue; }

      for (const [groupKey, sharpGroup] of groupOutcomes(sharpMk, ev)) {
        let fair;
        try { fair = devig(sharpGroup.map((o) => o.price), cfg.devigMethod); } catch { continue; }
        const pinMargin = margin(sharpGroup.map((o) => o.price));

        sharpSnapshots.push({
          event_id: ev.id, market: mkKey, group_key: groupKey,
          outcomes: sharpGroup.map((o, i) => ({ name: o.name, point: o.point, pin_odds: o.price, fair_prob: fair[i] })),
          seen_at: now.toISOString(),
        });

        sharpGroup.forEach((sOut, i) => {
          let best = null;
          for (const book of ev.bookmakers) {
            if (!cfg.softBooks.includes(book.key)) continue;
            const mk = marketsOf(book).get(mkKey);
            if (!mk) continue;
            const g = groupOutcomes(mk, ev).get(groupKey);
            const o = g?.find((x) => x.name === sOut.name);
            if (!o) continue;
            if (ageSec(mk.last_update, now) > cfg.maxStalenessSec) { reject('soft_elavult'); continue; }
            if (!best || o.price > best.price) best = { book: book.key, price: o.price };
          }
          if (!best) return;

          const edge = best.price * fair[i] - 1;
          stats.compared++;
          if (edge > 0) stats.positive++;
          if (!stats.best || edge > stats.best.edge) {
            stats.best = {
              edge, book: best.book, price: best.price, fair_odds: 1 / fair[i],
              label: `${ev.home_team} – ${ev.away_team} | ${groupKey} ${sOut.name}`,
            };
          }
          if (edge < cfg.minEdge) return; // nem value -> nem is számoljuk elutasításnak
          if (edge > cfg.maxEdge) { reject('tul_nagy_elony'); return; }
          if (best.price > cfg.maxOdds || best.price < cfg.minOdds) { reject('odds_tartomanyon_kivul'); return; }
          if (minutesToStart < cfg.minMinutesToStart) { reject('kezdeshez_tul_kozel'); return; }

          signals.push({
            event_id: ev.id,
            sport_key: ev.sport_key,
            home_team: ev.home_team,
            away_team: ev.away_team,
            commence_time: ev.commence_time,
            market: mkKey,
            group_key: groupKey,
            outcome_name: sOut.name,
            point: sOut.point,
            soft_book: best.book,
            soft_odds: best.price,
            pin_odds: sOut.price,
            pin_margin: round(pinMargin, 4),
            fair_prob: round(fair[i], 5),
            fair_odds: round(1 / fair[i], 3),
            edge: round(edge, 4),
            // Ennyi odds kell legalább a saját irodádnál, hogy még meglegyen a MIN_EDGE:
            min_odds: round((1 + cfg.minEdge) / fair[i], 2),
            minutes_to_start: Math.round(minutesToStart),
            detected_at: now.toISOString(),
          });
        });
      }
    }
  }
  return { signals, sharpSnapshots, rejected, stats };
}

function round(x, d) { const f = 10 ** d; return Math.round(x * f) / f; }
