// Fogadások elszámolása végeredmény alapján (1 egység tét), ázsiai negyedvonalakkal együtt.

/** Egy "egyszerű" vonal kimenetele a különbség előjele szerint: win / push / loss. */
const lineResult = (diff) => (diff > 1e-9 ? 'win' : diff < -1e-9 ? 'loss' : 'push');

/**
 * Ázsiai vonal: ha a vonal negyedes (pl. 2.25, -0.75), a tét fele-fele megy a két szomszédos vonalra.
 * `diffAt(line)` adja meg a fogadó szempontjából vett különbséget az adott vonalon.
 * Visszatér: kifizetési szorzó 1 egységre (0 = vesztett, 1 = visszajár, odds = nyert).
 */
function asianPayout(line, odds, diffAt) {
  const isQuarter = Math.abs(line * 4 - Math.round(line * 4)) < 1e-9 && Math.abs(line * 2 - Math.round(line * 2)) > 1e-9;
  const pay = (r) => (r === 'win' ? odds : r === 'push' ? 1 : 0);
  if (!isQuarter) return pay(lineResult(diffAt(line)));
  return (pay(lineResult(diffAt(line - 0.25))) + pay(lineResult(diffAt(line + 0.25)))) / 2;
}

/**
 * @param sig  { market, outcome_name, point, soft_odds, home_team, away_team }
 * @param home hazai pontszám, @param away vendég pontszám
 * @returns {{ result: string, profit: number }}
 */
export function settleSignal(sig, home, away) {
  const odds = Number(sig.soft_odds);
  let payout;

  if (sig.market === 'h2h') {
    const winner = home > away ? sig.home_team : away > home ? sig.away_team : 'Draw';
    if (winner === 'Draw' && sig.outcome_name !== 'Draw') {
      // Döntetlen kétesélyes (pl. kosár/hoki moneyline) piacon: a hosszabbítással együtt értendő
      // eredményben nem lehet döntetlen; ha mégis az, a tét visszajár.
      payout = sig.sport_key?.startsWith('soccer') ? 0 : 1;
    } else {
      payout = winner === sig.outcome_name ? odds : 0;
    }
  } else if (sig.market === 'totals') {
    const total = home + away;
    const line = Number(sig.point);
    const dir = sig.outcome_name === 'Over' ? 1 : -1;
    payout = asianPayout(line, odds, (l) => dir * (total - l));
  } else if (sig.market === 'spreads') {
    const isHome = sig.outcome_name === sig.home_team;
    const own = isHome ? home : away;
    const opp = isHome ? away : home;
    payout = asianPayout(Number(sig.point), odds, (l) => own + l - opp);
  } else {
    throw new Error(`Nem támogatott piac: ${sig.market}`);
  }

  const profit = Math.round((payout - 1) * 10000) / 10000;
  let result;
  if (payout === 0) result = 'vesztett';
  else if (Math.abs(payout - 1) < 1e-9) result = 'visszajár';
  else if (Math.abs(payout - odds) < 1e-9) result = 'nyert';
  else result = payout > 1 ? 'fel_nyert' : 'fel_vesztett';
  return { result, profit };
}

/** Az Odds API /scores válaszából kiolvassa a hazai és vendég pontszámot. */
export function parseScores(game) {
  if (!game?.completed || !Array.isArray(game.scores)) return null;
  const get = (team) => game.scores.find((s) => s.name === team)?.score;
  const h = Number(get(game.home_team));
  const a = Number(get(game.away_team));
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  return { home: h, away: a };
}
