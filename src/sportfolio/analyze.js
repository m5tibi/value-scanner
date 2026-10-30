import { sportHu, untilHu, durationHu } from '../format.js';

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
/**
 * Javasolt tét egységben (1 egység = a bankroll unitPct %-a), tört Kelly alapján, felső korláttal.
 * p = a megteendő oldal fair valószínűsége, odds = a saját irodád oddsa.
 * 0,25 egységre lefelé kerekítve; ha nincs előny, 0.
 */
export function stakeUnits(p, odds, { kellyFraction = 0.25, maxUnits = 3, unitPct = 1 } = {}) {
  if (!(odds > 1) || !(p > 0 && p < 1)) return 0;
  const kelly = (p * odds - 1) / (odds - 1); // a bankroll ekkora része a teljes Kelly
  if (kelly <= 0) return 0;
  const units = (kelly * kellyFraction * 100) / unitPct;
  return Math.min(maxUnits, Math.floor(units * 4) / 4);
}

/** Tét-lépcső: néhány oddsszinten (a jelzés oddsától lefelé) mennyi a javasolt tét. */
export function stakeLadder(p, signalOdds, thresholdRaw, stakeOpts) {
  const levels = new Set([signalOdds]);
  for (const f of [1.06, 1.03]) {
    const o = Math.ceil(thresholdRaw * f * 100) / 100;
    if (o < signalOdds) levels.add(o);
  }
  return [...levels]
    .sort((a, b) => b - a)
    .map((odds) => ({ odds, units: stakeUnits(p, odds, stakeOpts) }))
    .filter((x) => x.units > 0);
}

/**
 * Tét-lépcső kiírása; az egymás utáni azonos tétű szinteket összevonja:
 *   [{2.06,1.5},{1.85,1.5},{1.80,1}] -> "<b>1,5 E</b> @2.06–1.85 · 1 E @1.80"
 */
export function formatStakes(stakes) {
  const groups = [];
  for (const s of stakes) {
    const g = groups.at(-1);
    if (g && g.units === s.units) g.low = s.odds; else groups.push({ units: s.units, high: s.odds, low: s.odds });
  }
  const u = (x) => String(x).replace('.', ',');
  return groups.map((g, i) => {
    const odds = g.low < g.high ? `@${g.high.toFixed(2)}–${g.low.toFixed(2)}` : `@${g.high.toFixed(2)}`;
    return i === 0 ? `<b>${u(g.units)} E</b> ${odds}` : `${u(g.units)} E ${odds}`;
  }).join(' · ');
}

export function analyzeSignal(sig, { minEdge = 0.02, maxEdge = 0.10, hugeEdge = 0.20, hugeMaxUnits = 1, minMinutes = 5, now = new Date(), stake: stakeOpts } = {}) {
  const valueMk = classifyMarket(sig.value.market);
  const refMk = classifyMarket(sig.ref.market);
  const sameMarket = isComplementary(valueMk, refMk);

  // Küszöb: a Pinnacle ellentétes oldalából, árrés nélkül (konzervatív: a teljes árrést a mi oldalunkra terheli).
  const threshold = 1 / (1 - 1 / sig.ref.odds);
  const edge = sig.value.odds / threshold - 1;
  const minutesToStart = sig.startAt ? Math.round((sig.startAt.getTime() - now.getTime()) / 60000) : null;

  const warnings = [];
  if (!sameMarket) warnings.push('A két láb NEM ugyanaz a piac (pl. eltérő döntetlen-kezelés vagy vonal) – a küszöb nem megbízható.');
  // Előny-kategória: normál / nagy (10–20%) / nagyon nagy (20% felett)
  const category = edge > hugeEdge ? 'nagyon_nagy_elony' : edge > maxEdge ? 'nagy_elony' : 'normal';
  if (category === 'nagyon_nagy_elony') {
    warnings.push(`Nagyon nagy eltérés (${(edge * 100).toFixed(0)}%) – csak ha nálad is ≥ küszöb. Az iroda érvénytelenítheti vagy hamarabb limitálhat; tét max. ${String(hugeMaxUnits).replace('.', ',')} E.`);
  } else if (category === 'nagy_elony') {
    warnings.push(`Gyanúsan nagy előny (${(edge * 100).toFixed(0)}%) – a jelzés oddsa valószínűleg elavult, nézd meg a saját irodádat.`);
  }
  if (minutesToStart !== null && minutesToStart < 0) warnings.push('A meccs már elkezdődött – a jelzés élő oddsra vonatkozhat.');
  else if (minutesToStart !== null && minutesToStart < minMinutes) warnings.push(`Kezdésig csak ${durationHu(minutesToStart)}.`);
  if (edge < minEdge) warnings.push(`Kicsi az előny már a jelzésben is (${(edge * 100).toFixed(1)}%).`);
  if (valueMk.type === 'EH') warnings.push('Európai (háromesélyes) hendikep – ne keverd össze az ázsiaival.');
  if (valueMk.type === 'UNKNOWN') warnings.push(`Ismeretlen piackód: ${sig.value.market}`);

  let verdict;
  // Csak az eltérő piac és a már elkezdett meccs kihagyandó; a nagy előnyt a saját oddsod küszöb-ellenőrzése szűri.
  if (!sameMarket || (minutesToStart !== null && minutesToStart < 0)) verdict = 'kihagy';
  else if (warnings.length) verdict = 'ovatosan';
  else verdict = 'mehet';

  const p = 1 / threshold; // konzervatív fair valószínűség
  const effStake = category === 'nagyon_nagy_elony'
    ? { ...stakeOpts, maxUnits: Math.min(stakeOpts?.maxUnits ?? 3, hugeMaxUnits) }
    : stakeOpts;
  const stakes = verdict === 'kihagy' || valueMk.type === 'UNKNOWN' ? [] : stakeLadder(p, sig.value.odds, threshold, effStake);

  return {
    toBet: describe(valueMk, sig.home, sig.away),
    stakes,
    valueMarket: valueMk,
    sameMarket,
    threshold: Math.ceil(threshold * 100) / 100, // felfelé kerekítve, hogy biztosan meglegyen
    edge,
    category,
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
  const when = untilHu(a.minutesToStart);
  return [
    `${ICON[a.verdict]} <b>${TEXT[a.verdict]}</b>`,
    // <code> = koppintásra vágólapra kerül a Telegramban (a csapatnevek külön-külön, és a liga is)
    `<code>${esc(sig.home)}</code> – <code>${esc(sig.away)}</code>`,
    `${esc(sportHu(sig.sport))} · <code>${esc(sig.league)}</code>`,
    `🕒 ${start}${when} · ${esc(periodHu(sig.period))}`,
    ``,
    `👉 <b>${esc(a.toBet)}</b>`,
    `Csak ha az odds <b>≥ ${a.threshold.toFixed(2)}</b>`,
    ...(a.stakes?.length
      ? [`💰 Tét: ${formatStakes(a.stakes)}`]
      : []),
    `Jelzésben: ${esc(sig.value.book)} ${sig.value.odds} · előny ${(a.edge * 100).toFixed(1)}%`,
    `Referencia: ${esc(sig.ref.book)} ${esc(sig.ref.market)} @ ${sig.ref.odds}`,
    ...(a.warnings.length ? ['', ...a.warnings.map((w) => `⚠️ ${esc(w)}`)] : []),
  ].join('\n');
}
