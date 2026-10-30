// Sportfolio-jelzés kiértékelése: mit kell megtenni, mi a küszöb-odds, és milyen csapdák vannak benne.

/** Piac-kód értelmezése, pl. "AH1(-8.5)", "TO(3.0) for Team1", "Team2 Win", "X2", "AH1(-1.5) - Sets". */
export function classifyMarket(raw) {
  let s = raw.trim();
  let unit = 'pont';
  const UNITS = { sets: 'szett', maps: 'pálya', kills: 'ölés', games: 'játék', corners: 'szöglet', cards: 'lap' };
  const um = /\s-\s*([A-Za-z]+)$/.exec(s);
  if (um && UNITS[um[1].toLowerCase()]) { unit = UNITS[um[1].toLowerCase()]; s = s.slice(0, um.index); }
  s = s.replace(/\/DNB$/i, ''); // Draw No Bet = AH 0
  let team = null;
  const ft = /\s+for\s+Team([12])$/i.exec(s);
  if (ft) { team = +ft[1]; s = s.slice(0, ft.index); }

  let m;
  if ((m = /^AH([12])\(([+-]?[\d.]+)\)$/.exec(s))) return { type: 'AH', side: +m[1], line: +m[2], unit, raw };
  if ((m = /^EH([12X])\(([+-]?[\d.]+)\)$/.exec(s))) return { type: 'EH', side: m[1], line: +m[2], unit, raw };
  if ((m = /^T([OU])\(([\d.]+)\)$/.exec(s))) return { type: 'T', dir: m[1], line: +m[2], team, unit, raw };
  if ((m = /^Team([12]) Win$/i.exec(s))) return { type: 'ML', side: +m[1], unit, raw };
  if ((m = /^(1X|X2|12|1|X|2)$/.exec(s))) return { type: '3W', sel: m[1], unit, raw };
  return { type: 'UNKNOWN', raw };
}

const COMPLEMENT_3W = { 1: 'X2', X2: '1', 2: '1X', '1X': '2', X: '12', 12: 'X' };

// AH ±0.5 és a kétesélyes győzelem ugyanaz, mint egy 1X2/kettős esély kimenetel.
function asThreeWay(m) {
  if (m.type === 'ML') return { type: '3W', sel: m.side === 1 ? '1' : '2', unit: m.unit };
  if (m.type === 'AH' && Math.abs(Math.abs(m.line) - 0.5) < 1e-9) {
    const sel = m.side === 1 ? (m.line > 0 ? '1X' : '1') : (m.line > 0 ? 'X2' : '2');
    return { type: '3W', sel, unit: m.unit };
  }
  return m;
}

/** Igaz, ha a két láb pontosan ugyanannak a piacnak a két ellentétes oldala (így a küszöb-számítás érvényes). */
export function isComplementary(a, b) {
  if (a.type !== b.type) {
    const a3 = asThreeWay(a), b3 = asThreeWay(b);
    return a3.type === '3W' && b3.type === '3W' && a3.unit === b3.unit && COMPLEMENT_3W[a3.sel] === b3.sel;
  }
  switch (a.type) {
    case 'AH': return a.side !== b.side && Math.abs(a.line + b.line) < 1e-9 && a.unit === b.unit;
    case 'T': return a.dir !== b.dir && a.line === b.line && a.team === b.team && a.unit === b.unit;
    case 'ML': return a.side !== b.side;
    case '3W': return COMPLEMENT_3W[a.sel] === b.sel;
    default: return false;
  }
}

const PERIODS = {
  'Regular time': 'rendes játékidő',
  'Full time with overtimes': 'hosszabbítással együtt',
  'Full time with overtime and penalties': 'hosszabbítással és büntetőkkel együtt',
  '1st Half': '1. félidő',
  '2nd Half': '2. félidő',
  Match: 'teljes mérkőzés',
  '1st Set': '1. szett',
  '2nd Set': '2. szett',
  '1st Quarter': '1. negyed',
  '1st Period': '1. harmad',
};
export const periodHu = (p) => PERIODS[p] ?? p;

const signed = (x) => (x > 0 ? `+${x}` : `${x}`);

/** Magyar leírás arról, mit kell megtenni. */
export function describe(mk, home, away) {
  const teamOf = (side) => (side === 1 || side === '1' ? home : away);
  switch (mk.type) {
    case 'AH':
      return mk.line === 0
        ? `${teamOf(mk.side)} ázsiai hendikep 0 (döntetlennél visszajár)`
        : `${teamOf(mk.side)} ${signed(mk.line)}${mk.unit !== 'pont' ? ` ${mk.unit}` : ''} (ázsiai hendikep)`;
    case 'T': {
      const who = mk.team ? `${teamOf(mk.team)}: ` : 'Összesen ';
      return `${who}${mk.dir === 'O' ? 'több' : 'kevesebb'} mint ${mk.line}${mk.unit !== 'pont' ? ` ${mk.unit}` : ''}`;
    }
    case 'ML': return `${teamOf(mk.side)} nyer (kétesélyes, döntetlen nincs)`;
    case '3W':
      return { 1: `${home} nyer (1X2)`, X: 'Döntetlen (1X2)', 2: `${away} nyer (1X2)`,
        '1X': `${home} vagy döntetlen (kettős esély)`, X2: `${away} vagy döntetlen (kettős esély)`,
        12: 'Nem lesz döntetlen (12)' }[mk.sel];
    case 'EH': return `${mk.side === 'X' ? 'Döntetlen' : teamOf(mk.side)} európai hendikep ${signed(mk.line)} (háromesélyes!)`;
    default: return mk.raw;
  }
}

/**
 * @param sig  parseSignal() eredménye
 * @param opts { minEdge, maxEdge, minMinutes, now }
 */
export function analyzeSignal(sig, { minEdge = 0.02, maxEdge = 0.10, minMinutes = 5, now = new Date() } = {}) {
  const valueMk = classifyMarket(sig.value.market);
  const refMk = classifyMarket(sig.ref.market);
  const sameMarket = isComplementary(valueMk, refMk);

  // Küszöb: a Pinnacle ellentétes oldalából, árrés nélkül (konzervatív: a teljes árrést a mi oldalunkra terheli).
  const threshold = 1 / (1 - 1 / sig.ref.odds);
  const edge = sig.value.odds / threshold - 1;
  const minutesToStart = sig.startAt ? Math.round((sig.startAt.getTime() - now.getTime()) / 60000) : null;

  const warnings = [];
  if (!sameMarket) warnings.push('A két láb NEM ugyanaz a piac (pl. eltérő döntetlen-kezelés vagy vonal) – a küszöb nem megbízható.');
  if (edge > maxEdge) warnings.push(`Gyanúsan nagy előny (${(edge * 100).toFixed(0)}%) – valószínűleg elavult vagy hibás odds, az iroda érvénytelenítheti.`);
  if (minutesToStart !== null && minutesToStart < 0) warnings.push('A meccs már elkezdődött – a jelzés élő oddsra vonatkozhat.');
  else if (minutesToStart !== null && minutesToStart < minMinutes) warnings.push(`Kezdésig csak ${minutesToStart} perc.`);
  if (edge < minEdge) warnings.push(`Kicsi az előny már a jelzésben is (${(edge * 100).toFixed(1)}%).`);
  if (valueMk.type === 'EH') warnings.push('Európai (háromesélyes) hendikep – ne keverd össze az ázsiaival.');
  if (valueMk.type === 'UNKNOWN') warnings.push(`Ismeretlen piackód: ${sig.value.market}`);

  let verdict;
  if (!sameMarket || edge > 0.20 || (minutesToStart !== null && minutesToStart < 0)) verdict = 'kihagy';
  else if (warnings.length) verdict = 'ovatosan';
  else verdict = 'mehet';

  return {
    toBet: describe(valueMk, sig.home, sig.away),
    valueMarket: valueMk,
    sameMarket,
    threshold: Math.ceil(threshold * 100) / 100, // felfelé kerekítve, hogy biztosan meglegyen
    edge,
    minutesToStart,
    warnings,
    verdict,
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const ICON = { mehet: '✅', ovatosan: '⚠️', kihagy: '⛔' };
const TEXT = { mehet: 'Mehet, ha megvan a küszöb', ovatosan: 'Óvatosan', kihagy: 'Inkább hagyd ki' };

export function formatAnalysis(sig, a) {
  const start = sig.startAt
    ? sig.startAt.toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '?';
  const when = a.minutesToStart === null ? '' : a.minutesToStart >= 0 ? ` (${a.minutesToStart} perc múlva)` : ' (már megy)';
  return [
    `${ICON[a.verdict]} <b>${TEXT[a.verdict]}</b>`,
    `<b>${esc(sig.home)} – ${esc(sig.away)}</b>`,
    `${esc(sig.sport)} · ${esc(sig.league)}`,
    `🕒 ${start}${when} · ${esc(periodHu(sig.period))}`,
    ``,
    `👉 <b>${esc(a.toBet)}</b>`,
    `Csak ha az odds <b>≥ ${a.threshold.toFixed(2)}</b>`,
    `Jelzésben: ${esc(sig.value.book)} ${sig.value.odds} · előny ${(a.edge * 100).toFixed(1)}%`,
    `Referencia: ${esc(sig.ref.book)} ${esc(sig.ref.market)} @ ${sig.ref.odds}`,
    ...(a.warnings.length ? ['', ...a.warnings.map((w) => `⚠️ ${esc(w)}`)] : []),
  ].join('\n');
}
