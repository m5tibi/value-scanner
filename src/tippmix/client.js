// TippmixPro (EveryMatrix) odds-olvasó – minimális WAMP-kliens, csak olvasásra, vendégként (bejelentkezés nélkül).
// Protokoll: wss://sportsapi.tippmixpro.hu/v2, alprotokoll "wamp.2.json", realm "www.tippmixpro.hu".
import WebSocket from 'ws';

export const TMP_URL = 'wss://sportsapi.tippmixpro.hu/v2';
export const TMP_ORIGIN = 'https://sports2.tippmixpro.hu';
export const OPERATOR = '2901';

const HELLO = 1, WELCOME = 2, ABORT = 3, ERROR = 8, CALL = 48, RESULT = 50, REGISTER = 64, REGISTERED = 65, INVOCATION = 68, YIELD = 70;

export function connectTmp({ url = TMP_URL, timeoutMs = 15000, log = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, ['wamp.2.json'], { headers: { Origin: TMP_ORIGIN, 'User-Agent': 'Mozilla/5.0' } });
    let reqId = 100;
    const pending = new Map();
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('Időtúllépés a kapcsolódáskor')); }, timeoutMs);
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('unexpected-response', (_req, res) => { clearTimeout(timer); reject(new Error(`HTTP ${res.statusCode} a kapcsolódáskor`)); });
    ws.on('open', () => ws.send(JSON.stringify([HELLO, 'www.tippmixpro.hu', { agent: 'Wampy.js v6.2.2', roles: { caller: {}, subscriber: {}, publisher: {}, callee: {} } }])));
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      const [type] = msg;
      if (type === WELCOME) {
        clearTimeout(timer);
        resolve(client);
      } else if (type === ABORT) {
        clearTimeout(timer); reject(new Error(`WAMP ABORT: ${JSON.stringify(msg).slice(0, 200)}`));
      } else if (type === RESULT || type === REGISTERED || type === ERROR) {
        const id = type === ERROR ? msg[2] : msg[1];
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (type === ERROR) p.reject(new Error(`WAMP hiba: ${msg[4] ?? ''} ${JSON.stringify(msg[6] ?? {}).slice(0, 200)}`));
        else p.resolve(type === RESULT ? (msg[4] ?? msg[3]) : msg[2]);
      } else if (type === INVOCATION) {
        ws.send(JSON.stringify([YIELD, msg[1], {}])); // élő frissítés – nem használjuk, csak nyugtázzuk
      }
    });
    const send = (frame, id, ms = timeoutMs) => new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej });
      ws.send(JSON.stringify(frame));
      setTimeout(() => { if (pending.delete(id)) rej(new Error(`Időtúllépés: ${JSON.stringify(frame).slice(0, 120)}`)); }, ms);
    });
    const client = {
      call(proc, kwargs = {}) { const id = ++reqId; return send([CALL, id, {}, proc, [], kwargs], id); },
      /** Egy téma pillanatképe: feliratkozás (a szerver így kéri), majd initialDump. */
      async dump(topic) {
        const id = ++reqId;
        await send([REGISTER, id, {}, topic], id).catch(() => {});
        const r = await client.call('/sports#initialDump', { topic });
        return r?.records ?? [];
      },
      close() { try { ws.close(); } catch { /* */ } },
    };
  });
}

export const topics = {
  tournaments: (sportId, venueId, lang = 'hu') => `/sports/${OPERATOR}/${lang}/tournaments/${sportId}/${venueId}`,
  leagueMatches: (tournamentId, lang = 'hu') => `/sports/${OPERATOR}/${lang}/tournament-aggregator-groups-overview/${tournamentId}/default-event-info/BOTH/3196`,
  matchOdds: (matchId, group = 'NEPSZERU', lang = 'hu') => `/sports/${OPERATOR}/${lang}/${matchId}/match-odds/market-group/${group}`,
};

/** Rekordokból meccsek → piacok → kimenetelek (odds). */
export function parseRecords(records) {
  const matches = new Map(), markets = new Map(), outcomes = new Map(), offers = new Map(), rel = new Map();
  for (const r of records) {
    if (r._type === 'MATCH') matches.set(r.id, { id: r.id, name: r.name, start: new Date(r.startTime), league: r.parentName, sport: r.sportName, markets: [] });
    else if (r._type === 'MARKET') markets.set(r.id, r);
    else if (r._type === 'OUTCOME') outcomes.set(r.id, r);
    else if (r._type === 'BETTING_OFFER' && r.isAvailable !== false && r.statusId === '1') offers.set(r.outcomeId, r.odds);
    else if (r._type === 'MARKET_OUTCOME_RELATION') { if (!rel.has(r.marketId)) rel.set(r.marketId, []); rel.get(r.marketId).push(r.outcomeId); }
  }
  for (const m of markets.values()) {
    const match = matches.get(m.eventId);
    if (!match) continue;
    match.markets.push({
      id: m.id, name: m.name, type: m.bettingTypeName, part: m.eventPartName,
      outcomes: (rel.get(m.id) ?? []).map((oid) => outcomes.get(oid)).filter(Boolean)
        .map((o) => ({ name: o.translatedName?.trim(), line: o.paramFloat1 ?? null, odds: offers.get(o.id) ?? null })),
    });
  }
  return [...matches.values()];
}
