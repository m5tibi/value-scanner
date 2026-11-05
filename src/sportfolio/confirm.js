// Kereszt-megerősítés a csatornák között: ha ugyanarra a meccsre és ugyanabba az irányba
// (hazai/vendég, több/kevesebb) egy MÁSIK csatorna is jelzett, azt 🔁-vel jelöljük;
// ha ellenkező irányba, ↔️ ellentmondásként.
//
// A csapatneveket a források eltérően írják ("SV Rohrbach" vs. "Sv Schermann Rohrbach an der Lafnitz"),
// ezért ékezet- és rövidítésmentes szó-egyezést nézünk, plusz a kezdési időt.

const STOP = new Set([
  'fc', 'sc', 'sv', 'sk', 'ik', 'if', 'bk', 'hc', 'hk', 'fk', 'ac', 'as', 'cd', 'cf', 'ud', 'sd', 'afc', 'cfc', 'bc', 'kk', 'vfb', 'vfl', 'tsv', 'fsv', 'ssv', 'spvgg',
  'club', 'the', 'de', 'la', 'le', 'an', 'der', 'den', 'van', 'von', 'and', 'et', 'del', 'el', 'da', 'do',
]);
// Gyakori, nem megkülönböztető szavak: önmagukban nem elég az egyezéshez
const GENERIC = new Set(['real', 'united', 'city', 'sporting', 'athletic', 'atletico', 'dynamo', 'dinamo', 'olympic', 'racing',
  'town', 'rovers', 'wanderers', 'county', 'junior', 'youth', 'women', 'reserves', 'basket', 'basketball', 'hockey', 'handball', 'team',
  // klubnév-előtagok, amelyek sok csapatnál ismétlődnek (pl. Hapoel X / Hapoel Y)
  'hapoel', 'maccabi', 'beitar', 'bnei', 'ironi', 'sport', 'sports', 'union', 'olimpia', 'olympia', 'spartak', 'lokomotiv',
  'torpedo', 'slavia', 'inter', 'deportivo', 'deportes', 'universidad', 'academy', 'stars', 'ladies', 'girls', 'wfc', 'u19', 'u20', 'u21', 'u23']);

export function tokens(name) {
  return String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter((t) => t && !STOP.has(t));
}

const distinctive = (ts) => ts.filter((t) => t.length >= 4 && !GENERIC.has(t) && !QUAL[t]);

// Minősítők: különfogadás-események (szöglet, lap) soha nem azonosak a fő meccsel;
// női/utánpótlás-eltérésnél csak gyengébb az egyezés (a források néha elhagyják a "Women" szót).
const QUAL = {
  corners: 'special', corner: 'special', bookings: 'special', booking: 'special', cards: 'special', specials: 'special',
  women: 'women', ladies: 'women', wfc: 'women', femenil: 'women', feminino: 'women', femenino: 'women', w: 'women',
  u17: 'u17', u18: 'u18', u19: 'u19', u20: 'u20', u21: 'u21', u23: 'u23', ii: 'ii', reserves: 'ii', b: 'ii',
};
const quals = (ts) => new Set(ts.map((t) => QUAL[t]).filter(Boolean));

/**
 * Mennyire ugyanaz a csapat (0..1): teljes egyezés = 1; különben a közös megkülönböztető szavak
 * aránya a rövidebb név megkülönböztető szavaihoz ("SV Rohrbach" vs "Sv Schermann Rohrbach an der Lafnitz" = 1).
 */
export function teamScore(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  if (ta.join(' ') === tb.join(' ')) return 1;
  const qa = quals(ta), qb = quals(tb);
  if (qa.has('special') !== qb.has('special')) return 0;
  const da = distinctive(ta), db = new Set(distinctive(tb));
  if (!da.length || !db.size) return 0;
  const shared = da.filter((t) => db.has(t)).length;
  const sameQual = qa.size === qb.size && [...qa].every((q) => qb.has(q));
  return (shared / Math.min(da.length, db.size)) * (sameQual ? 1 : 0.6);
}

export const sameTeam = (a, b) => teamScore(a, b) >= 0.5;

/** 0, ha nem ugyanaz a meccs; különben a két csapat egyezésének összege (max. 2). */
export function matchScore(x, y, toleranceMin = 20) {
  if (!x.startAt || !y.startAt) return 0;
  if (Math.abs(new Date(x.startAt) - new Date(y.startAt)) > toleranceMin * 60e3) return 0;
  const h = teamScore(x.home, y.home), a = teamScore(x.away, y.away);
  return h >= 0.5 && a >= 0.5 ? h + a : 0;
}

export const sameMatch = (x, y, toleranceMin = 20) => matchScore(x, y, toleranceMin) > 0;

/** A lista legjobban egyező eleme (toMatch: elem -> {home, away, startAt}), vagy null. */
export function bestMatch(list, sig, toMatch, toleranceMin = 30) {
  let best = null, bestScore = 0;
  for (const item of list ?? []) {
    for (const m of [].concat(toMatch(item))) {
      const sc = matchScore(m, sig, toleranceMin);
      if (sc > bestScore) { best = item; bestScore = sc; }
    }
  }
  return best;
}

const FULL = new Set(['Regular time', 'Full time with overtimes', 'Full time with overtime and penalties', 'Match', 'Full time']);

/** Irány a surebet-jelzésből (analyzeSignal valueMarket-je alapján). null = nem összevethető. */
export function directionSf(sig, a) {
  if (sig.period && !FULL.has(sig.period)) return null; // félidős/szettes jelzés nem ugyanaz a fogadás
  const mk = a.valueMarket;
  if (!mk) return null;
  switch (mk.type) {
    case 'AH': case 'ML': return mk.unit === 'pont' ? (mk.side === 1 ? 'home' : 'away') : null;
    case 'EH': return mk.side === 'X' ? 'draw' : (String(mk.side) === '1' ? 'home' : 'away');
    case '3W': return { 1: 'home', '1X': 'home', 2: 'away', X2: 'away', X: 'draw' }[mk.sel] ?? null;
    case 'T': return !mk.team && mk.unit === 'pont' ? (mk.dir === 'O' ? 'over' : 'under') : null;
    default: return null;
  }
}

/** Irány az OddsHub-jelzésből. */
export function directionOh(sig) {
  if (sig.pick === null || sig.pick === undefined) return null;
  const { type } = sig.market;
  if (type === 'totals') return sig.pick === 0 ? 'over' : 'under';
  if (type === 'ml' && sig.pin.length === 3) return ['home', 'draw', 'away'][sig.pick];
  return sig.pick === 0 ? 'home' : 'away';
}

const OPPOSITE = { home: 'away', away: 'home', over: 'under', under: 'over' };

/**
 * Memória az utóbbi jelzésekről; check() megmondja, van-e megerősítő vagy ellentmondó jelzés másik csatornából.
 * entry: { channel, home, away, startAt, dir, label, at }
 */
export function makeConfirmTracker({ keepHours = 6, windowMin = 90 } = {}) {
  let items = [];
  return {
    check(entry, now = new Date()) {
      items = items.filter((x) => now - x.at < keepHours * 3600e3);
      if (!entry.dir) return { confirms: [], contradicts: [] };
      const recent = items.filter((x) => x.channel !== entry.channel && now - x.at <= windowMin * 60e3 && sameMatch(x, entry));
      return {
        confirms: recent.filter((x) => x.dir === entry.dir),
        contradicts: recent.filter((x) => x.dir === OPPOSITE[entry.dir]),
      };
    },
    add(entry) { if (entry.dir) items.push(entry); },
    size: () => items.length,
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const ago = (at, now) => { const m = Math.max(0, Math.round((now - at) / 60000)); return m < 1 ? 'most' : `${m} perce`; };

/** Fejléc-sorok az üzenet elejére (üres tömb, ha nincs mit mondani). */
export function confirmLines({ confirms, contradicts }, now = new Date()) {
  const out = [];
  for (const x of confirms.slice(-2)) out.push(`🔁 <b>Megerősítve</b>: ${esc(x.channel)} is jelezte (${ago(x.at, now)}) — ${esc(x.label)}`);
  for (const x of contradicts.slice(-2)) out.push(`↔️ <b>Ellentmondás</b>: ${esc(x.channel)} az ellenkező oldalt jelezte (${ago(x.at, now)}) — ${esc(x.label)}`);
  return out;
}
