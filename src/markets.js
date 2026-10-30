// Piacok csoportosítása: csak pontosan azonos piacot és vonalat hasonlítunk össze
// (pl. Pinnacle Over 2.5 vs 1xBet Over 2.5), soha nem "Win" vs "AH(0.0)" jellegű párosítást.

/**
 * Egy iroda egy piacának kimeneteleit "teljes csoportokra" bontja.
 * Visszatér: Map<groupKey, Array<{name, point, price}>>
 *  - h2h:     egy csoport, az összes kimenetellel (focinál Draw is)
 *  - totals:  pontonként Over + Under
 *  - spreads: a hazai csapat vonala szerint; a két csapat vonala egymás ellentettje
 */
export function groupOutcomes(market, event) {
  const groups = new Map();
  const outs = market.outcomes ?? [];

  if (market.key === 'h2h') {
    if (outs.length >= 2) groups.set('h2h', outs.map((o) => ({ name: o.name, point: null, price: o.price })));
    return groups;
  }

  if (market.key === 'totals') {
    const byPoint = new Map();
    for (const o of outs) {
      if (o.point === undefined || o.point === null) continue;
      const k = `totals@${o.point}`;
      if (!byPoint.has(k)) byPoint.set(k, []);
      byPoint.get(k).push({ name: o.name, point: o.point, price: o.price });
    }
    for (const [k, g] of byPoint) {
      const names = new Set(g.map((x) => x.name));
      if (g.length === 2 && names.has('Over') && names.has('Under')) groups.set(k, g);
    }
    return groups;
  }

  if (market.key === 'spreads') {
    const home = outs.filter((o) => o.name === event.home_team);
    const away = outs.filter((o) => o.name === event.away_team);
    for (const h of home) {
      const a = away.find((x) => Math.abs(x.point + h.point) < 1e-9);
      if (!a) continue;
      groups.set(`spreads@${h.point}`, [
        { name: h.name, point: h.point, price: h.price },
        { name: a.name, point: a.point, price: a.price },
      ]);
    }
    return groups;
  }

  return groups;
}

/** Ember által olvasható piac-leírás magyarul. */
export function describeSelection({ market, name, point }, event) {
  if (market === 'h2h') {
    if (name === 'Draw') return 'Döntetlen (1X2)';
    return `${name} győzelem${event?.sport_key?.startsWith('soccer') ? ' (1X2)' : ''}`;
  }
  if (market === 'totals') return `${name === 'Over' ? 'Több mint' : 'Kevesebb mint'} ${point} (összesen)`;
  if (market === 'spreads') {
    if (Number(point) === 0) return `${name} ázsiai hendikep 0 (döntetlennél visszajár)`;
    return `${name} ${point > 0 ? '+' : ''}${point} (ázsiai hendikep)`;
  }
  return `${market} ${name} ${point ?? ''}`.trim();
}
