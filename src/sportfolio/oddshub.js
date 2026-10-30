// "Tippmix Value" / "TPro Value" csatornák (OddsHub-formátum): Pinnacle-mozgás + egy soft iroda (TippmixPRO, Tippmix, Bet365...) oddsa.
//
// Példa (a vastag/aláhúzott odds a javasolt oldal; a figyelő ezt **...**-gal jelöli):
//   New odds update on Pinnacle
//   Hockey - Finland - Mestis
//   Kiekko-Vantaa vs Roki
//   30.10.2026 17:30
//   [Totals (59.5) (alt. line)]
//   1.833⬆️ (1.680) - 1.909⬇️ (2.100)
//   🟢 Opening [(59)]
//   1.595 - 2.250
//   TippmixPRO [(Totals 59.5)]
//   1.51 - **2.23**
//   💰 Stake: 2.00u
//   🎯 EV: 108.99%   |   EV: None (not equal lines)

import { devig, margin } from '../devig.js';
import { sportHu, untilHu } from '../format.js';
import { stakeLadder, formatStakes } from './analyze.js';

const NUM = '(\\d+(?:\\.\\d+)?)';
const clean = (s) => s.replace(/\*/g, '').trim();

/** "30.10.2026 17:30" budapesti idő -> Date */
export function budapestTime(s) {
  const m = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/.exec(s ?? '');
  if (!m) return null;
  const [, d, mo, y, h, mi] = m.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // A budapesti eltolás az adott pillanatban (nyári/téli idő)
  const wall = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'Europe/Budapest' }));
  const utcWall = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess - (wall - utcWall));
}

function oddsLine(line) {
  // "1.833⬆️ (1.680) - 1.909⬇️ (2.100)" vagy "3.970 (3.970)" középen
  const parts = clean(line).split(/\s+-\s+/);
  const out = parts.map((p) => {
    const m = new RegExp(`^${NUM}\\s*(⬆️|⬇️|⬆|⬇)?\\s*(?:\\(${NUM}\\))?$`).exec(p.trim());
    return m && { odds: Number(m[1]), arrow: m[2] ? (m[2].startsWith('⬇') ? 'down' : 'up') : null, prev: m[3] ? Number(m[3]) : null };
  });
  return out.every(Boolean) && out.length >= 2 ? out : null;
}

const MARKET_RE = /^(Totals|Total|Spreads?|Handicap|Asian Handicap)\s*\(([-+]?\d+(?:\.\d+)?)\)(\s*\(alt\.? line\))?/i;
const marketType = (s) => (/^total/i.test(s) ? 'totals' : 'spread');

/**
 * @returns {null|object} null, ha nem ilyen üzenet
 */
export function parseOddsHub(text, postedAt = new Date()) {
  if (!text || !/New odds update on/i.test(text)) return null;
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const ref = /New odds update on\s+\**([A-Za-z0-9 ]+?)\**\s*$/i.exec(lines[0])?.[1] ?? 'Pinnacle';

  let i = 1;
  const title = clean(lines[i++] ?? '');
  const [sport, ...rest] = title.split(/\s+-\s+/);
  const evLine = clean(lines[i++] ?? '');
  const vs = /^(.+?)\s+vs\.?\s+(.+)$/i.exec(evLine);
  if (!vs) return null;
  const startAt = budapestTime(clean(lines[i++] ?? ''));

  let market = { type: 'ml', line: null, alt: false };
  const mk = MARKET_RE.exec(clean(lines[i] ?? ''));
  if (mk) { market = { type: marketType(mk[1]), line: Number(mk[2]), alt: !!mk[3] }; i++; }

  const pin = oddsLine(lines[i++] ?? '');
  if (!pin) return null;

  let opening = null;
  if (/Opening/i.test(lines[i] ?? '')) {
    const ol = /\(([-+]?\d+(?:\.\d+)?)\)/.exec(lines[i]);
    const oo = oddsLine(lines[i + 1] ?? '');
    opening = { line: ol ? Number(ol[1]) : market.line, odds: oo?.map((x) => x.odds) ?? null };
    i += oo ? 2 : 1;
  }

  // Soft iroda: "TippmixPRO (Totals 59.5)" + odds-sor
  const bookLine = clean(lines[i++] ?? '');
  const bm = /^(.+?)(?:\s*\((?:Totals?|Spreads?|Handicap|Asian Handicap)\s*([-+]?\d+(?:\.\d+)?)\))?$/i.exec(bookLine);
  const softRaw = lines[i++] ?? '';
  const softParts = softRaw.split(/\s+-\s+/);
  const soft = softParts.map((p) => Number(clean(p)));
  if (!bm || soft.some((x) => !(x > 1)) || soft.length !== pin.length) return null;
  const bold = softParts.findIndex((p) => /\*\*/.test(p));

  const rest2 = lines.slice(i).join('\n');
  const stake = /Stake:\s*([\d.]+)\s*u/i.exec(rest2);
  const evm = /EV:\s*\**\s*([\d.]+)%/i.exec(rest2);

  const softLine = bm[2] !== undefined ? Number(bm[2]) : market.line;
  // Melyik oldalt kell megtenni: a kiemelt odds; ha nincs, a Pinnacle-nél csökkenő (⬇️) oldal.
  let pick = bold;
  let pickFrom = 'kiemelés';
  if (pick < 0) { pick = pin.findIndex((x) => x.arrow === 'down'); pickFrom = 'nyíl'; }

  return {
    source: 'oddshub',
    refBook: ref,
    sport: sport?.trim(),
    league: rest.join(' - ').trim(),
    home: vs[1].trim(),
    away: vs[2].trim(),
    startAt,
    postedAt,
    market,
    pin,
    opening,
    soft: { book: bm[1].trim(), line: softLine, odds: soft },
    pick: pick >= 0 ? pick : null,
    pickFrom: pick >= 0 ? pickFrom : null,
    theirStake: stake ? Number(stake[1]) : null,
    theirEv: evm ? Number(evm[1]) / 100 - 1 : null,
  };
}

// ---------- Becslés eltérő vonalnál ----------

const erf = (x) => {
  // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const PhiInv = (p) => { let lo = -8, hi = 8; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (Phi(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; };

function poissonCdf(k, lam) { let s = 0, t = Math.exp(-lam); for (let n = 0; n <= k; n++) { s += t; t *= lam / (n + 1); } return s; }
function poissonPmf(k, lam) { let t = Math.exp(-lam); for (let n = 1; n <= k; n++) t *= lam / n; return t; }
/** P(over L) push nélkül (egész vonalnál a visszajáró eset kivéve) */
function poissonOver(L, lam) {
  const k = Math.floor(L);
  if (Number.isInteger(L)) return (1 - poissonCdf(L, lam)) / (1 - poissonPmf(L, lam));
  return 1 - poissonCdf(k, lam);
}

const isQuarter = (x) => Math.abs((x * 4) % 2) === 1; // .25 / .75
const SPORT = (s) => String(s ?? '').toLowerCase();
const GOAL_SPORTS = /^(football|soccer|hockey|ice hockey)$/;

/**
 * Az over (totals) vagy a hazai hendikep (spread) valószínűsége a soft iroda vonalán,
 * a Pinnacle vonalából és fair esélyéből. null, ha a sportághoz/vonalhoz nincs megbízható modell.
 */
export function estimateAtLine({ sport, type, pinLine, pFirst, softLine }) {
  const s = SPORT(sport);
  if (isQuarter(pinLine) || isQuarter(softLine)) return null;
  if (type === 'totals') {
    if (GOAL_SPORTS.test(s)) {
      let lo = 0.05, hi = 25;
      for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (poissonOver(pinLine, m) < pFirst) lo = m; else hi = m; }
      return poissonOver(softLine, (lo + hi) / 2);
    }
    const sd = s === 'basketball' ? 0.09 * pinLine : s === 'handball' ? 5.5 : null;
    if (!sd) return null;
    const mu = pinLine + sd * PhiInv(pFirst);
    return 1 - Phi((softLine - mu) / sd);
  }
  // Hendikep: a hazai fedez h mellett, ha (hazai − vendég) + h > 0
  const sd = s === 'basketball' ? 12 : s === 'handball' ? 4.5 : null;
  if (!sd) return null;
  const mu = -pinLine + sd * PhiInv(pFirst);
  return Phi((mu + softLine) / sd);
}

// ---------- Elemzés ----------

const ceil2 = (x) => Math.ceil(x * 100) / 100;

function describePick(sig) {
  const s = SPORT(sig.sport);
  const { type } = sig.market;
  const n = sig.pin.length;
  const team = sig.pick === 0 ? sig.home : sig.away;
  if (type === 'ml') {
    if (n === 3) return sig.pick === 1 ? 'Döntetlen (1X2, rendes játékidő)' : `${sig.pick === 0 ? sig.home : sig.away} győzelem (1X2, rendes játékidő)`;
    if (s === 'tennis') return `${team} nyeri a meccset`;
    if (s === 'hockey' || s === 'ice hockey') return `${team} győzelem (hosszabbítással, büntetőkkel együtt)`;
    if (s === 'basketball') return `${team} győzelem (hosszabbítással együtt)`;
    return `${team} győzelem`;
  }
  const L = sig.soft.line;
  if (type === 'totals') {
    const unit = s === 'basketball' ? ' pont' : s === 'tennis' ? ' gém' : GOAL_SPORTS.test(s) || s === 'handball' ? ' gól' : '';
    return `${sig.pick === 0 ? 'Több mint' : 'Kevesebb mint'} ${String(L).replace('.', ',')}${unit}`;
  }
  const h = sig.pick === 0 ? L : -L;
  return `${team} ${h > 0 ? '+' : ''}${String(h).replace('.', ',')} (hendikep)`;
}

/** Hol keresd a TippmixPro / Tippmix kínálatában */
function tippmixHint(sig) {
  if (!/tippmix/i.test(sig.soft.book)) return null;
  const s = SPORT(sig.sport);
  const { type } = sig.market;
  if (type === 'ml' && sig.pin.length === 2 && (s === 'hockey' || s === 'ice hockey' || s === 'basketball')) return '»Ki nyeri? – Teljes esemény« (hosszabbítással)';
  if (type === 'ml' && sig.pin.length === 3) return '»1X2 – Rendes játékidő«';
  if (type === 'totals' && s === 'basketball') return '»Pontszám – Hosszabbítással«';
  if (type === 'totals' && (s === 'handball' || s === 'football' || s === 'soccer')) return '»Gólszám – Rendes játékidő«';
  if (type === 'totals') return 'gólszám – nézd meg, rendes játékidő vagy hosszabbítással';
  return null;
}

export function analyzeOddsHub(sig, { minEdge = 0.02, hugeEdge = 0.20, hugeMaxUnits = 1, estMaxUnits = 1, maxMargin = 0.06, wildMargin = 0.10, now = new Date(), stake: stakeOpts } = {}) {
  const warnings = [];
  const minutesToStart = sig.startAt ? Math.round((sig.startAt.getTime() - now.getTime()) / 60000) : null;
  const pinOdds = sig.pin.map((x) => x.odds);
  const pinMargin = margin(pinOdds);
  const base = { minutesToStart, pinMargin, warnings, hint: tippmixHint(sig) };

  if (sig.pick === null) {
    return { ...base, verdict: 'kihagy', toBet: '?', edge: null, threshold: null, minOdds: null, stakes: [], estimated: false,
      warnings: [...warnings, 'Nem derül ki, melyik oldalt kell megtenni.'] };
  }
  const toBet = describePick(sig);
  const softOdds = sig.soft.odds[sig.pick];
  const fair = devig(pinOdds, 'power');
  const sameLine = sig.market.type === 'ml' || sig.soft.line === sig.market.line;

  let p, threshold = null, estimated = false;
  if (sameLine) {
    p = fair[sig.pick];
    // Konzervatív küszöb: a teljes árrést a többi kimenetelre terheli.
    const others = pinOdds.reduce((a, o, j) => (j === sig.pick ? a : a + 1 / o), 0);
    threshold = others < 1 ? 1 / (1 - others) : null;
  } else {
    const pFirst = fair[0];
    const est = estimateAtLine({ sport: sig.sport, type: sig.market.type, pinLine: sig.market.line, pFirst, softLine: sig.soft.line });
    if (est === null) {
      return { ...base, verdict: 'kihagy', toBet, edge: null, threshold: null, minOdds: null, stakes: [], estimated: true, softOdds,
        warnings: [...warnings, `Eltérő vonal (Pinnacle ${sig.market.line}, ${sig.soft.book} ${sig.soft.line}) – ehhez a sportághoz nincs megbízható átszámítás.`] };
    }
    p = sig.pick === 0 ? est : 1 - est;
    estimated = true;
    warnings.push(`Becslés: a Pinnacle ${sig.market.line}-es vonalából átszámítva a ${sig.soft.line}-re.`);
  }

  const edge = softOdds * p - 1;
  const fairOdds = 1 / p;
  // Minimum odds: fair + minEdge (becslésnél dupla ráhagyással)
  const minOdds = ceil2(fairOdds * (1 + (estimated ? 2 * minEdge : minEdge)));
  if (pinMargin > wildMargin) warnings.push(`A Pinnacle árrése nagyon nagy (${(pinMargin * 100).toFixed(1)}%): kis piac, a fair odds bizonytalan – tét max. 1 E.`);
  else if (pinMargin > maxMargin) warnings.push(`A Pinnacle árrése itt nagy (${(pinMargin * 100).toFixed(1)}%), a fair odds pontatlanabb.`);
  if (sig.market.alt) warnings.push('Alternatív vonal: alacsonyabb limit, nagyobb árrés a Pinnacle-nél.');
  if (edge > hugeEdge) warnings.push(`Nagyon nagy eltérés (${(edge * 100).toFixed(0)}%) – valószínűleg hír (sérülés, kezdő) mozgatta; tét max. ${String(hugeMaxUnits).replace('.', ',')} E.`);
  if (minutesToStart !== null && minutesToStart < 0) warnings.push('A meccs már elkezdődött.');

  let verdict;
  if ((minutesToStart !== null && minutesToStart < 0) || softOdds < minOdds) verdict = 'kihagy';
  else if (!estimated && threshold && softOdds >= threshold && edge <= hugeEdge && pinMargin <= maxMargin) verdict = 'mehet';
  else verdict = 'ovatosan';
  if (!estimated && threshold && softOdds < threshold && verdict !== 'kihagy') {
    warnings.push(`A konzervatív küszöb (${ceil2(threshold).toFixed(2)}) alatt van – csak kisebb téttel.`);
  }

  let maxUnits = stakeOpts?.maxUnits ?? 3;
  if (verdict === 'ovatosan') maxUnits = Math.min(maxUnits, estimated ? estMaxUnits : 1.5);
  if (edge > hugeEdge) maxUnits = Math.min(maxUnits, hugeMaxUnits);
  if (pinMargin > wildMargin) maxUnits = Math.min(maxUnits, 1);
  const stakes = verdict === 'kihagy' ? [] : stakeLadder(p, softOdds, minOdds / (1 + minEdge), { ...stakeOpts, maxUnits });

  return {
    ...base,
    verdict, toBet, softOdds, fairOdds, edge, estimated,
    threshold: threshold ? ceil2(threshold) : minOdds, // a követéshez (javulás/emlékeztető)
    consThreshold: threshold ? ceil2(threshold) : null,
    minOdds, stakes, warnings,
  };
}

// ---------- Formázás ----------

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const ICON = { mehet: '✅', ovatosan: '⚠️', kihagy: '⛔' };
const TEXT = { mehet: 'Mehet, ha megvan a küszöb', ovatosan: 'Óvatosan', kihagy: 'Inkább hagyd ki' };
const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

export function formatOddsHub(sig, a, { channel } = {}) {
  const start = sig.startAt
    ? sig.startAt.toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '?';
  const pk = sig.pick ?? 0;
  const pinPick = sig.pin[pk];
  const move = pinPick ? `${pinPick.prev ?? '?'} → <b>${pinPick.odds}</b>${pinPick.arrow === 'down' ? ' ⬇️' : pinPick.arrow === 'up' ? ' ⬆️' : ''}` : '';
  const lineInfo = sig.market.type === 'ml' ? '' : ` (${sig.market.line}${sig.market.alt ? ', alt.' : ''})`;
  const lines = [
    `${ICON[a.verdict]} <b>${TEXT[a.verdict]}</b> · ${esc(sig.soft.book)}`,
    `<code>${esc(sig.home)}</code> – <code>${esc(sig.away)}</code>`,
    `${esc(sportHu(sig.sport))} · <code>${esc(sig.league)}</code>`,
    `🕒 ${start}${untilHu(a.minutesToStart)}`,
    ``,
    `👉 <b>${esc(a.toBet)}</b>`,
  ];
  if (a.hint) lines.push(`📍 ${esc(sig.soft.book)}: ${esc(a.hint)}`);
  if (a.edge !== null && a.edge !== undefined) {
    lines.push(`${esc(sig.soft.book)}: <b>${a.softOdds}</b> · fair ${a.fairOdds.toFixed(2)}${a.estimated ? ' (becslés)' : ''} · előny <b>${pct(a.edge)}</b>`);
    lines.push(a.consThreshold
      ? (a.consThreshold > a.minOdds
        ? `Biztos: odds <b>≥ ${a.consThreshold.toFixed(2)}</b> · minimum ≥ ${a.minOdds.toFixed(2)} (kisebb téttel)`
        : `Csak ha az odds <b>≥ ${a.consThreshold.toFixed(2)}</b>`)
      : `Csak ha az odds <b>≥ ${a.minOdds.toFixed(2)}</b>`);
  }
  if (a.stakes?.length) {
    lines.push(`💰 Tét: ${formatStakes(a.stakes)}`);
  }
  lines.push(`${esc(sig.refBook)}${lineInfo}: ${move} · árrés ${(a.pinMargin * 100).toFixed(1)}%`);
  if (sig.theirEv !== null) lines.push(`Jelzésben: EV ${pct(sig.theirEv)} · tét ${sig.theirStake ?? '?'}u`);
  lines.push(`⚡ Gyorsan: az iroda általában 1–5 percen belül igazít.`);
  if (a.warnings.length) lines.push('', ...a.warnings.map((w) => `⚠️ ${esc(w)}`));
  if (channel) lines.push(`<i>${esc(channel)}</i>`);
  return lines.join('\n');
}

/** Telegram-entitásokból (félkövér/aláhúzott) **...** jelölés, hogy a kiemelt odds felismerhető legyen. */
export function markEmphasis(text, entities = []) {
  const ranges = new Map();
  for (const e of entities ?? []) {
    const cls = e?.className ?? e?.constructor?.name ?? '';
    if (/Bold|Underline/.test(cls)) ranges.set(`${e.offset}:${e.length}`, e);
  }
  // Minden beszúrási pontot hátulról előre illesztünk be, így az átfedő tartományok sem csúsznak el.
  const marks = [...ranges.values()].flatMap((e) => [e.offset, e.offset + e.length]).sort((a, b) => b - a);
  let out = text ?? '';
  for (const pos of marks) out = out.slice(0, pos) + '**' + out.slice(pos);
  return out;
}
