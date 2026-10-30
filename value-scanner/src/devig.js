// Árrés eltávolítása (de-vig) a sharp iroda oddsaiból -> fair valószínűségek.
//
// multiplicative: p_i = (1/o_i) / Σ(1/o_j)          — egyszerű, arányosan osztja szét az árrést
// power:          p_i = (1/o_i)^k, ahol k olyan, hogy Σp_i = 1
//                 — a favorit–esélytelen torzítást jobban kezeli, ezért ez az alapértelmezett.

export function devig(odds, method = 'power') {
  if (!Array.isArray(odds) || odds.length < 2 || odds.some((o) => !(o > 1))) {
    throw new Error(`Érvénytelen odds-készlet: ${JSON.stringify(odds)}`);
  }
  const implied = odds.map((o) => 1 / o);
  const overround = implied.reduce((a, b) => a + b, 0);

  if (method === 'multiplicative' || overround <= 1) {
    // Ha nincs árrés (vagy negatív), a multiplikatív normalizálás a biztonságos.
    return implied.map((p) => p / overround);
  }
  if (method !== 'power') throw new Error(`Ismeretlen de-vig módszer: ${method}`);

  // Σ p_i^k = 1 megoldása k-ra felezéssel; k > 1, mert overround > 1.
  const sum = (k) => implied.reduce((a, p) => a + p ** k, 0);
  let lo = 1, hi = 10;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (sum(mid) > 1) lo = mid; else hi = mid;
  }
  const k = (lo + hi) / 2;
  const probs = implied.map((p) => p ** k);
  const s = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / s);
}

/** Pinnacle-árrés (overround - 1), pl. 0.025 = 2,5%. */
export function margin(odds) {
  return odds.reduce((a, o) => a + 1 / o, 0) - 1;
}
