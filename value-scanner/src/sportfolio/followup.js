// Sportfolio-jelzések követése a figyelőben (memóriában, újraindításkor az adatbázisból visszatöltve):
//   - ugyanarra a kimenetelre jövő ismétlést nem küldi újra, csak ha javult az odds és az előny (🔔)
//   - kezdéskor egy emlékeztetőt küld meccsenként a kiküldött jelzésekről (⏰)

import { isImprovement, splitDue } from '../alerts.js';
import { periodHu } from './analyze.js';

const REGULAR = new Set(['Regular time', 'Full time with overtimes', 'Full time', 'Match']);

export function makeFollowUp({ improveDelta = 0.02, improveMax = 2, windowMin = 20 } = {}) {
  const sent = new Map();    // kimenetel-kulcs -> { odds, edge, book, count }
  const pending = new Map(); // meccs-kulcs -> { home, away, sport, league, startAt, items: Map, ids: [] }

  const matchKey = (s) => `${s.home}|${s.away}|${s.startAt ? new Date(s.startAt).toISOString() : ''}`;
  const selKey = (s, toBet) => `${matchKey(s)}|${s.period ?? ''}|${toBet}`;
  const label = (s, toBet) => (s.period && !REGULAR.has(s.period) ? `${toBet} · ${periodHu(s.period)}` : toBet);

  function record(sig, a, msgId, count = 0) {
    const k = selKey(sig, a.toBet);
    sent.set(k, { odds: Number(sig.value.odds), edge: Number(a.edge), book: sig.value.book, count });
    if (!sig.startAt) return;
    const mk = matchKey(sig);
    if (!pending.has(mk)) {
      pending.set(mk, { home: sig.home, away: sig.away, sport: sig.sport, league: sig.league, startAt: new Date(sig.startAt), items: new Map(), ids: [] });
    }
    const m = pending.get(mk);
    // Mindig a legutóbb kiküldött (legjobb) árat mutatjuk az emlékeztetőben.
    m.items.set(k, { toBet: label(sig, a.toBet), book: sig.value.book, odds: Number(sig.value.odds), threshold: a.threshold });
    if (msgId != null) m.ids.push(msgId);
  }

  return {
    /** new = még nem küldtük; improved = jobb ár és nagyobb előny; repeat = ismétlés, nem kell küldeni */
    decide(sig, a) {
      const prev = sent.get(selKey(sig, a.toBet));
      if (!prev) return { action: 'new' };
      const cur = { odds: Number(sig.value.odds), edge: Number(a.edge), book: sig.value.book };
      if (isImprovement(prev, cur, { minDelta: improveDelta, maxCount: improveMax })) return { action: 'improved', prev, cur };
      return { action: 'repeat', prev };
    },

    record(sig, a, msgId, action = 'new') {
      const prev = sent.get(selKey(sig, a.toBet));
      record(sig, a, msgId, action === 'improved' ? (prev?.count ?? 0) + 1 : 0);
    },

    /** Újraindításkor: sportfolio_signals sorokból (kiküldött, még nem emlékeztetett). */
    load(rows) {
      for (const r of rows) {
        const sig = { home: r.home, away: r.away, startAt: r.start_at, period: r.period, sport: r.sport, league: r.league,
          value: { book: r.value_book, odds: Number(r.value_odds) } };
        const a = { toBet: r.to_bet, edge: Number(r.edge), threshold: Number(r.threshold) };
        const k = selKey(sig, a.toBet);
        const prev = sent.get(k);
        // Ha ugyanarra több sor is van, a legjobb előnyű marad meg.
        if (!prev || a.edge > prev.edge) record(sig, a, r.msg_id, prev ? prev.count + 1 : 0);
        else pending.get(matchKey(sig))?.ids.push(r.msg_id);
      }
    },

    /** Esedékes emlékeztetők kivétele (a lejártakat is kiveszi, hogy ne gyűljenek). */
    takeDue(now = new Date()) {
      const all = [...pending.entries()].map(([key, m]) => ({ key, ...m, items: [...m.items.values()] }));
      const { due, expired } = splitDue(all, now, windowMin);
      for (const m of [...due, ...expired]) pending.delete(m.key);
      // Régi kimenetelek takarítása (1 nappal kezdés után)
      for (const k of sent.keys()) {
        const t = Date.parse(k.split('|')[2]);
        if (t && now.getTime() - t > 86_400_000) sent.delete(k);
      }
      return { due, expired };
    },

    size: () => ({ sent: sent.size, pending: pending.size }),
  };
}
