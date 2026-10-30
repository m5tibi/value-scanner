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
  'town', 'rovers', 'wanderers', 'county', 'junior', 'youth', 'women', 'reserves', 'basket', 'basketball', 'hockey', 'handball', 'team']);

export function tokens(name) {
  return String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter((t) => t && !STOP.has(t));
}

/** Ugyanaz a csapat? (teljes egyezés, vagy közös, legalább 4 betűs, nem általános szó) */
export function sameTeam(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  const sb = new Set(tb);
  return ta.some((t) => t.length >= 4 && !GENERIC.has(t) && sb.has(t));
}

export function sameMatch(x, y, toleranceMin = 20) {
  if (!x.startAt || !y.startAt) return false;
  if (Math.abs(new Date(x.startAt) - new Date(y.startAt)) > toleranceMin * 60e3) return false;
  return sameTeam(x.home, y.home) && sameTeam(x.away, y.away);
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
