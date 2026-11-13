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
    // A kétesélyes (döntetlen nélküli) és a háromesélyes (döntetlennel) győztes-piac NEM ugyanaz:
    // külön csoportkulcsot kapnak, így soha nem hasonlítjuk össze őket (2026-11-13: kézi, Füchse–Kiel).
    if (outs.length >= 2) {
      const threeWay = outs.length === 3 && outs.some((o) => o.name === 'Draw');
      groups.set(threeWay ? 'h2h@3' : 'h2h', outs.map((o) => ({ name: o.name, point: null, price: o.price })));
    }
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
/**
 * A kimenetel magyar leírása, sportág szerint úgy, ahogy a fogadóirodáknál keresni kell:
 *   foci: rendes játékidő, ázsiai hendikep · kosár/amerikai foci: pont-hendikep, hosszabbítással
 *   hoki/kézi: gól, hendikep · tenisz: gém
 */
export function describeSelection({ market, name, point }, event) {
  const sport = String(event?.sport_key ?? '').split('_')[0];
  const sign = (p) => `${Number(p) > 0 ? '+' : ''}${p}`;
  const unit = { soccer: 'gól', icehockey: 'gól', handball: 'gól', basketball: 'pont', americanfootball: 'pont', baseball: 'futás', tennis: 'gém' }[sport];
  const time = { soccer: 'rendes játékidő', handball: 'rendes játékidő', basketball: 'hosszabbítással', americanfootball: 'hosszabbítással' }[sport];
  const tag = (...xs) => { const t = xs.filter(Boolean).join(', '); return t ? ` (${t})` : ''; };

  if (market === 'h2h') {
    if (name === 'Draw') return `Döntetlen${tag(sport === 'soccer' && '1X2', time)}`;
    if (sport === 'tennis') return `${name} nyeri a meccset`;
    return `${name} győzelem${tag(sport === 'soccer' && '1X2', time)}`;
  }
  if (market === 'totals') return `${name === 'Over' ? 'Több mint' : 'Kevesebb mint'} ${point}${unit ? ` ${unit}` : ''}${tag(!unit && 'összesen', time)}`;
  if (market === 'spreads') {
    if (sport === 'soccer') {
      if (Number(point) === 0) return `${name} – döntetlennél visszajár${tag('ázsiai hendikep 0', time)}`;
      return `${name} ${sign(point)}${tag('ázsiai hendikep', time)}`;
    }
    return `${name} ${sign(point)}${tag(unit ? `${unit}-hendikep` : 'hendikep', time)}`;
  }
  return `${market} ${name} ${point ?? ''}`.trim();
}
