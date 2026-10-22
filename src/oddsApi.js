// The Odds API v4 kliens kvótafigyeléssel.
// Költség (a dokumentáció szerint): piacok száma × régiók száma; max. 10 iroda a `bookmakers`
// paraméterben 1 régiónak számít. Üres válasz nem fogy kreditet. A /scores daysFrom-mal 2 kredit.

const BASE = 'https://api.the-odds-api.com/v4';

export class OddsApi {
  constructor({ apiKey, fetchImpl = fetch }) {
    if (!apiKey) throw new Error('ODDS_API_KEY hiányzik');
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.remaining = null; // x-requests-remaining
    this.used = null;
  }

  async #get(path, params) {
    this.lastCost = null;
    const qs = new URLSearchParams({ apiKey: this.apiKey, ...params });
    const res = await this.fetch(`${BASE}${path}?${qs}`);
    const rem = res.headers.get('x-requests-remaining');
    const used = res.headers.get('x-requests-used');
    const last = res.headers.get('x-requests-last');
    this.lastCost = last !== null ? Number(last) : null;
    if (rem !== null) this.remaining = Number(rem);
    if (used !== null) this.used = Number(used);
    if (!res.ok) {
      const body = await res.text();
      const err = new Error(`Odds API ${res.status} ${path}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /** Egy sport meccsei a megadott irodákkal és piacokkal, csak a [now, now+lookahead] ablakban. */
  getOdds(sport, { bookmakers, markets, lookaheadHours }) {
    const now = new Date();
    const to = new Date(now.getTime() + lookaheadHours * 3600e3);
    const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    return this.#get(`/sports/${sport}/odds/`, {
      bookmakers: bookmakers.join(','),
      markets: markets.join(','),
      oddsFormat: 'decimal',
      dateFormat: 'iso',
      commenceTimeFrom: iso(now),
      commenceTimeTo: iso(to),
    });
  }

  /** Lezárt meccsek eredményei az utolsó 1-3 napból. */
  getScores(sport, daysFrom = 3) {
    return this.#get(`/sports/${sport}/scores/`, { daysFrom: String(daysFrom), dateFormat: 'iso' });
  }
}
