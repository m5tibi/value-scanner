// Adatforrás-teszt: pinnapi (Pinnacle) és OddsPapi (Pinnacle + TippmixPro) lekérdezése egy jelzés meccsére.
// A hálózati rész vékony; a kiértékelő függvények tiszták (tesztelhetők).

import { sameMatch } from '../sportfolio/confirm.js';

const TIMEOUT = 15_000;

export async function getJson(url, headers = {}, fetchImpl = fetch) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetchImpl(url, { headers, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* nem JSON */ }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

const SPORT = (s) => String(s ?? '').toLowerCase();
const near = (a, b, tol = 0.03) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= tol;

// ---------------- pinnapi ----------------

/** pinnapi sport_id a jelzés sportágából (dokumentáció: Reference / Sport IDs) */
export function pinnapiSportId(sport) {
  const s = SPORT(sport);
  if (s === 'football' || s === 'soccer') return 1;
  if (s === 'tennis') return 2;
  if (s === 'basketball') return 3;
  if (s === 'hockey' || s === 'ice hockey') return 4;
  if (s === 'american football') return 5;
  if (s === 'baseball') return 6;
  if (s === 'rugby') return 7;
  if (s === 'handball' || s === 'volleyball') return 10;
  if (s === 'esports' || s === 'e-sports') return 11;
  return null;
}

/** A fixtures-válaszból kiveszi az esemény-listát (a pontos burkolás nem dokumentált, ezért rugalmas). */
export function pinnapiEvents(json) {
  if (Array.isArray(json)) return json;
  for (const k of ['events', 'fixtures', 'data', 'items', 'result']) if (Array.isArray(json?.[k])) return json[k];
  return [];
}

export function findPinnapiEvent(events, sig) {
  return events.find((e) => sameMatch({ home: e.home, away: e.away, startAt: e.starts }, sig, 30)) ?? null;
}

/** A jelzés piacának Pinnacle-oddsai a pinnapi eseményből (periods.num_0). null, ha nincs ilyen vonal. */
export function pinnapiPrices(event, sig) {
  const p = event?.periods?.num_0 ?? (Array.isArray(event?.periods) ? event.periods[0] : null);
  if (!p) return null;
  const { type, line } = sig.market;
  if (type === 'ml') {
    const ml = p.money_line;
    if (!ml) return null;
    return sig.pin.length === 3 ? [ml.home, ml.draw, ml.away] : [ml.home, ml.away];
  }
  if (type === 'totals') {
    const t = Object.values(p.totals ?? {}).find((x) => Number(x.points) === Number(line));
    return t ? [t.over, t.under] : null;
  }
  const h = Object.values(p.spreads ?? {}).find((x) => Number(x.hdp) === Number(line));
  return h ? [h.home, h.away] : null;
}

// ---------------- OddsPapi ----------------

/** OddsPapi sportId keresése a /v4/sports listában név alapján. */
export function oddspapiSportId(sports, sport) {
  const s = SPORT(sport);
  const wants = s === 'hockey' || s === 'ice hockey' ? ['ice hockey', 'hockey']
    : s === 'football' || s === 'soccer' ? ['soccer', 'football'] : [s];
  const norm = (x) => String(x ?? '').toLowerCase().replace(/[-_]/g, ' ').trim();
  const list = Array.isArray(sports) ? sports : sports?.data ?? [];
  for (const want of wants) {
    const hit = list.find((x) => norm(x.sportName ?? x.name) === want || norm(x.slug) === want);
    if (hit) return hit.sportId ?? hit.id;
  }
  return null;
}

/** A TippmixPro (vagy Tippmix) bookmaker-slug a /v4/bookmakers listából. */
export function tippmixSlugs(bookmakers) {
  const list = Array.isArray(bookmakers) ? bookmakers : bookmakers?.data ?? Object.values(bookmakers ?? {});
  return list
    .map((b) => (typeof b === 'string' ? b : b.slug ?? b.bookmaker ?? b.bookmakerSlug ?? ''))
    .filter((s) => /tippmix/i.test(s));
}

export function findOddspapiFixture(fixtures, sig) {
  const list = Array.isArray(fixtures) ? fixtures : fixtures?.data ?? [];
  return list.find((f) => sameMatch({ home: f.participant1Name, away: f.participant2Name, startAt: f.startTime }, sig, 30)
    || sameMatch({ home: f.participant1ShortName, away: f.participant2ShortName, startAt: f.startTime }, sig, 30)) ?? null;
}

/** Egy iroda összes (aktív) ára egy fixture odds-válaszából: [{ price, market, outcome, changedAt }] */
export function oddspapiPrices(oddsJson, slug) {
  const bk = oddsJson?.bookmakerOdds?.[slug];
  if (!bk) return null;
  const out = [];
  for (const [mid, m] of Object.entries(bk.markets ?? {})) {
    for (const [oid, o] of Object.entries(m.outcomes ?? {})) {
      for (const pl of Object.values(o.players ?? {})) {
        if (pl?.price == null) continue;
        out.push({ price: Number(pl.price), marketId: mid, market: m.bookmakerMarketId ?? mid, outcome: pl.bookmakerOutcomeId ?? oid,
          changedAt: pl.changedAt ?? null, active: pl.active !== false, mainLine: pl.mainLine ?? null });
      }
    }
  }
  return out;
}

/** Megtalálható-e a jelzésben látott ár az iroda árai között? A legjobb (legközelebbi) találat. */
export function matchPrice(prices, target, tol = 0.02) {
  if (!prices?.length || target == null) return null;
  const hits = prices.filter((p) => p.active && near(p.price, target, tol)).sort((a, b) => Math.abs(a.price - target) - Math.abs(b.price - target));
  return hits[0] ?? null;
}
