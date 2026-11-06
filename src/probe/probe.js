// Adatforrás-teszt a figyelőben: egy OddsHub-jelzés (TPro / Tippmix Value) meccsét megkeresi
// a pinnapi-ban és az OddsPapi-ban, összeveti az oddsokat, és elmenti a probe_results táblába.
// Az ingyenes kereteket napi limit védi; a lekérések sorban, szünettel mennek; a jelzés kiküldését nem lassítja.
//
// Jelzés-fajták: 'oh' = TPro/Tippmix Value (OddsHub), 'sf' = Value NonStop (surebet: soft iroda + Pinnacle/BetinAsia).
// Beállítások (env): PINNAPI_KEY, ODDSPAPI_KEY, PROBE=0 (kikapcsolás), napi limitek jelzésszámban:
//   PROBE_PINNAPI_OH_DAILY (20), PROBE_PINNAPI_SF_DAILY (10), PROBE_ODDSPAPI_OH_DAILY (2), PROBE_ODDSPAPI_SF_DAILY (4)

import {
  getJson, pinnapiSportId, pinnapiEvents, findPinnapiEvent, pinnapiPrices, pinnapiFind,
  oddspapiSportId, tippmixSlugs, bookList, findSlug, timeTolerance, findOddspapiFixture, oddspapiPrices, matchPrice,
} from './providers.js';

const SHARP = /^(pinnacle|betinasia)$/i;

/** Value NonStop (surebet) jelzés -> a teszt közös alakja. A referencia-láb a Pinnacle/BetinAsia ára. */
export function fromSurebet(sig) {
  const refSharp = sig.ref && SHARP.test(sig.ref.book);
  return {
    sig: {
      kind: 'sf', sport: sig.sport, league: sig.league, home: sig.home, away: sig.away, startAt: sig.startAt,
      market: { type: `sf:${sig.value?.market ?? '?'}`, line: null }, pick: 0,
      pin: refSharp ? [{ odds: Number(sig.ref.odds) }] : [],
      soft: { book: sig.value?.book ?? '?', odds: [Number(sig.value?.odds)] },
    },
    a: { softOdds: Number(sig.value?.odds) },
  };
}

const PINNAPI = 'https://pinnapi.com';
const ODDSPAPI = 'https://api.oddspapi.io/v4';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' });

export function makeProbe({ env, db, log, fetchImpl = fetch }) {
  const pinKey = env.PINNAPI_KEY, opKey = env.ODDSPAPI_KEY;
  if (env.PROBE === '0' || (!pinKey && !opKey)) return null;
  const caps = {
    pinnapi: { oh: Number(env.PROBE_PINNAPI_OH_DAILY ?? 20), sf: Number(env.PROBE_PINNAPI_SF_DAILY ?? 10) },
    oddspapi: { oh: Number(env.PROBE_ODDSPAPI_OH_DAILY ?? 2), sf: Number(env.PROBE_ODDSPAPI_SF_DAILY ?? 4) },
  };
  const RAW_SAMPLES = 3; // az első néhány nyers választ elmentjük a későbbi feldolgozó megírásához

  let queue = Promise.resolve();
  const cache = new Map(); // listák rövid ideig (kevesebb lekérés)
  const cached = async (key, ttlMs, fn) => {
    const c = cache.get(key);
    if (c && Date.now() - c.at < ttlMs) return c.value;
    const value = await fn();
    cache.set(key, { at: Date.now(), value });
    return value;
  };

  const memCount = new Map(); // adatbázis nélkül (vagy DB-hiba esetén) is legyen napi limit
  async function counter(provider, kind, inc = 0) {
    const key = `probe_${provider}_${kind}_${today()}`;
    let n = memCount.get(key) ?? 0;
    try { if (db) n = Math.max(n, Number((await db.getState(key)) ?? 0)); } catch { /* marad a memóriás */ }
    n += inc;
    memCount.set(key, n);
    if (inc && db) await db.setState(key, String(n)).catch(() => {});
    return n;
  }
  async function rawSample(provider, payload) {
    if (!db) return null;
    const key = `probe_${provider}_raw_samples`;
    const n = Number((await db.getState(key)) ?? 0);
    if (n >= RAW_SAMPLES) return null;
    await db.setState(key, String(n + 1));
    return JSON.stringify(payload).slice(0, 200_000);
  }

  // ---------- pinnapi ----------
  async function probePinnapi(sig) {
    if (sig.kind === 'sf' && !sig.pin.length) return { found: false, skipped: true };
    const sportId = pinnapiSportId(sig.sport);
    if (!sportId) return { found: false, error: `ismeretlen sportág: ${sig.sport}` };
    const h = { 'x-portal-apikey': pinKey };
    let calls = 0;
    const list = await cached(`pin_fx_${sportId}`, 10 * 60e3, async () => {
      calls++;
      const r = await getJson(`${PINNAPI}/kit/v1/prematch/fixtures?sport_id=${sportId}&markets=0`, h, fetchImpl);
      if (!r.ok) throw new Error(`fixtures HTTP ${r.status}: ${r.text}`);
      return pinnapiEvents(r.json);
    });
    const ev = findPinnapiEvent(list, sig);
    if (!ev) return { found: false, calls, details: { events_in_sport: list.length } };
    await sleep(3500); // 20 lekérés/perc limit
    calls++;
    const r = await getJson(`${PINNAPI}/kit/v1/prematch/lines?event_id=${ev.event_id}`, h, fetchImpl);
    if (!r.ok) return { found: true, calls, event: String(ev.event_id), error: `lines HTTP ${r.status}: ${r.text}` };
    let evFull = pinnapiEvents(r.json)[0] ?? r.json?.event ?? r.json;
    let prices = sig.kind === 'sf' ? pinnapiFind(evFull, sig.pin[0]?.odds) : pinnapiPrices(evFull, sig);
    let raw = r.json;
    if (!prices) { // a "lines" nézetben nincs meg a vonal: a teljes piaclistát kérjük
      await sleep(3500);
      calls++;
      const m = await getJson(`${PINNAPI}/kit/v1/prematch/markets?event_id=${ev.event_id}`, h, fetchImpl);
      if (m.ok) {
        evFull = pinnapiEvents(m.json)[0] ?? m.json?.event ?? m.json;
        prices = sig.kind === 'sf' ? pinnapiFind(evFull, sig.pin[0]?.odds) : pinnapiPrices(evFull, sig);
        raw = m.json;
      }
    }
    const sigPin = sig.pin.map((x) => x.odds);
    return {
      found: true, calls, event: String(ev.event_id), home: ev.home, away: ev.away, league: ev.league_name,
      pinOdds: prices,
      pinMatch: sig.kind === 'sf' ? (sigPin.length ? !!prices : null)
        : prices ? prices.every((p, i) => Math.abs(Number(p) - sigPin[i]) <= 0.03) : null,
      raw: await rawSample('pinnapi', raw),
    };
  }

  // ---------- OddsPapi ----------
  async function opMeta() {
    return cached('op_meta', 24 * 3600e3, async () => {
      const saved = await db?.getState('probe_oddspapi_meta_v4');
      if (saved) return JSON.parse(saved);
      const s = await getJson(`${ODDSPAPI}/sports?apiKey=${opKey}`, {}, fetchImpl);
      await sleep(2200);
      const b = await getJson(`${ODDSPAPI}/bookmakers?apiKey=${opKey}`, {}, fetchImpl);
      if (!s.ok || !b.ok) throw new Error(`meta HTTP ${s.status}/${b.status}: ${s.ok ? b.text : s.text}`);
      const books = bookList(b.json);
      const meta = { sports: s.json, books, tippmix: tippmixSlugs(b.json), hasPinnacle: books.some((x) => x.slug === 'pinnacle') };
      // Magyar (vagy .hu-s) irodák: Vegas.hu, Tippmix, Szerencsejáték – a "LeoVegas" NEM ide tartozik
      const hu = books.filter((x) => /(^|[^a-z])vegas\.?hu|tipp?mix|szerencse|hungar|\.hu$/i.test(`${x.slug} ${x.name}`) && !/leovegas/i.test(x.slug));
      log(`🔎 OddsPapi magyar irodák: ${hu.map((x) => `${x.name} (${x.slug})`).join(', ') || 'nincs'}`);
      const n = Array.isArray(b.json) ? b.json.length : Array.isArray(b.json?.data) ? b.json.data.length : Object.keys(b.json ?? {}).length;
      log(`🔎 OddsPapi irodák (${n} db): Pinnacle ${meta.hasPinnacle ? 'van' : 'NINCS'}, Tippmix-slug: ${meta.tippmix.join(', ') || 'NINCS'}`);
      await db?.setState('probe_oddspapi_bookmakers_raw', JSON.stringify(b.json).slice(0, 100_000)).catch(() => {});
      await db?.setState('probe_oddspapi_meta_v4', JSON.stringify(meta));
      return meta;
    });
  }

  async function probeOddspapi(sig, softTarget) {
    const meta = await opMeta();
    const sportId = oddspapiSportId(meta.sports, sig.sport);
    if (!sportId) return { found: false, error: `sportId nem található: ${sig.sport}` };
    const w = Math.max(3, timeTolerance(sig.sport) / 60) * 3600e3;
    const from = new Date(sig.startAt.getTime() - w).toISOString().slice(0, 19) + 'Z';
    const to = new Date(sig.startAt.getTime() + w).toISOString().slice(0, 19) + 'Z';
    let calls = 0;
    const list = await cached(`op_fx_${sportId}_${from.slice(0, 13)}`, 15 * 60e3, async () => {
      calls++;
      const r = await getJson(`${ODDSPAPI}/fixtures?sportId=${sportId}&from=${from}&to=${to}&apiKey=${opKey}`, {}, fetchImpl);
      if (!r.ok) throw new Error(`fixtures HTTP ${r.status}: ${r.text}`);
      return r.json;
    });
    const fx = findOddspapiFixture(list, sig);
    if (!fx) return { found: false, calls, details: { fixtures_in_window: Array.isArray(list) ? list.length : null } };
    await sleep(2200);
    calls++;
    const softSlugs = [...new Set([findSlug(meta.books, sig.soft.book), ...meta.tippmix].filter(Boolean))];
    const books = ['pinnacle', ...softSlugs].join(',');
    const r = await getJson(`${ODDSPAPI}/odds?fixtureId=${fx.fixtureId}&bookmakers=${books}&oddsFormat=decimal&apiKey=${opKey}`, {}, fetchImpl);
    if (!r.ok) return { found: true, calls, event: fx.fixtureId, error: `odds HTTP ${r.status}: ${r.text}` };
    const present = Object.keys(r.json?.bookmakerOdds ?? {});
    const pin = oddspapiPrices(r.json, 'pinnacle');
    const pinHit = sig.pin.length ? matchPrice(pin, sig.pin[sig.pick ?? 0]?.odds) : null;
    let soft = null, softHit = null, softSlug = null;
    for (const slug of softSlugs) {
      const p = oddspapiPrices(r.json, slug);
      if (!p) continue;
      soft = p; softSlug = slug; softHit = matchPrice(p, softTarget);
      if (softHit) break;
    }
    return {
      found: true, calls, event: fx.fixtureId, home: fx.participant1Name, away: fx.participant2Name, league: fx.tournamentName,
      bookmakers: present, pinMatch: pin && sig.pin.length ? !!pinHit : null, softFound: !!soft, softMatch: soft ? !!softHit : null,
      softChangedAt: softHit?.changedAt ?? null,
      softSlugMapped: softSlugs[0] ?? null,
      details: { softBook: sig.soft.book, softSlug, softSlugs, softMarkets: soft ? new Set(soft.map((x) => x.market)).size : 0, pinHit, softHit },
      raw: await rawSample('oddspapi', r.json),
    };
  }

  const seen = new Set();
  async function run(provider, fn, sig, ref, a) {
    if (!(provider === 'pinnapi' ? pinKey : opKey)) return;
    const key = `${provider}|${sig.kind}|${sig.home}|${sig.away}|${sig.startAt.toISOString()}|${sig.market.type}|${sig.market.line}`;
    if (seen.has(key)) return;
    seen.add(key);
    if ((await counter(provider, sig.kind)) >= caps[provider][sig.kind]) return;
    let res;
    try { res = await fn(); } catch (e) { res = { found: false, error: e.message.slice(0, 300) }; }
    if (res.skipped) return;
    await counter(provider, sig.kind, 1);
    const softTxt = res.softFound != null
      ? ` · ${sig.soft.book}${res.softSlugMapped ? '' : ' (nincs ilyen iroda)'} ${res.softFound ? (res.softMatch ? `✓ ugyanaz az ár (${a.softOdds})` : `≠ más ár (jelzés ${a.softOdds})`) : 'nincs a meccsnél'}`
      : '';
    log(`🔎 ${provider} [${sig.kind === 'sf' ? 'NonStop' : 'OddsHub'}]: ${res.error ? `hiba – ${res.error}` : res.found
      ? `megvan (${res.home} – ${res.away})${res.pinOdds ? ` Pinnacle ${res.pinOdds.join('/')}` : ''}${res.pinMatch != null ? ` ${res.pinMatch ? '✓' : '≠'} jelzés (${sig.pin.map((x) => x.odds).join('/')})` : ''}${softTxt}`
      : 'nem találta a meccset'}`);
    await db?.insertProbe({
      channelId: ref.channelId, msgId: ref.msgId, provider, sig, a, ...res,
    }).catch((e) => log('DB-hiba (probe):', e.message));
  }

  return {
    /** Nem blokkol: sorba teszi a lekérdezést. */
    enqueue(sig, a, ref, kind = 'oh') {
      if (kind === 'sf') ({ sig, a } = fromSurebet(sig));
      else sig = { ...sig, kind: 'oh' };
      if (!sig?.startAt || sig.pick == null) return;
      queue = queue
        .then(() => run('pinnapi', () => probePinnapi(sig), sig, ref, a))
        .then(() => run('oddspapi', () => probeOddspapi(sig, a.softOdds ?? sig.soft.odds[sig.pick]), sig, ref, a))
        .catch((e) => log('Probe-hiba:', e.message));
    },
    caps,
  };
}
