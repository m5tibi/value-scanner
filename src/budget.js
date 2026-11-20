// Automatikus napi kreditkeret (DAILY_CREDIT_BUDGET=auto).
// A The Odds API havi kerete minden hónap 1-jén 00:00 UTC-kor nullázódik. A szkenner naponta egyszer,
// az első körben kiszámolja, mennyi jut rá a mai napra:
//   (megmaradt kredit − tartalék − a többi felhasználó (VIP Value Tipster) várható fogyasztása) / hátralévő napok

/** Hány nap van hátra a következő nullázásig (a mait is beleszámolva). */
export function daysUntilReset(now = new Date()) {
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(1, Math.ceil((reset - now.getTime()) / 86400e3));
}

/** A napi keret a megmaradt kreditből. */
export function computeDailyBudget({ remaining, now = new Date(), reserve = 0, otherDaily = 0, min = 0, max = Infinity }) {
  const days = daysUntilReset(now);
  const free = remaining - reserve - otherDaily * days;
  const per = Math.floor(free / days);
  return { budget: Math.max(min, Math.min(max, per)), days, free };
}

/**
 * A mai keret meghatározása (naponta egyszer, az eredményt az adatbázis őrzi).
 * A többi felhasználó fogyasztását a tegnapi adatokból méri: (tegnapi kiinduló − mai kiinduló) − a szkenner tegnapi fogyasztása.
 * Ha ez nem mérhető (első nap, hónapváltás), a becsült értéket (otherDailyDefault) használja.
 */
export const utcMonth = (d = new Date()) => d.toISOString().slice(0, 7);

export async function planDailyBudget(db, { today, cfg, log = () => {}, now = new Date() }) {
  const month = utcMonth(now);
  const remaining = Number(await db.getState('quota_remaining'));
  // A kvótaadat csak akkor érvényes, ha ebben a (UTC) hónapban mértük – a nullázás után a régi szám félrevezető.
  const fresh = Number.isFinite(remaining) && remaining > 0 && (await db.getState('quota_remaining_month')) === month;
  // Újratervezés: új nap, hónapváltás, vagy friss kvótaadat érkezett az alapértékes terv után
  const key = `${today}|${month}|${fresh ? 'q' : 'f'}`;
  if ((await db.getState('auto_budget_key')) === key) {
    return { budget: Number(await db.getState('auto_budget_value')) || cfg.dailyCreditFallback };
  }
  let budget = cfg.dailyCreditFallback, info = 'nincs még friss kvótaadat, alapérték';
  if (fresh) {
    let otherDaily = cfg.creditOtherDaily;
    const prevBase = Number(await db.getState('auto_budget_base'));
    const prevUsed = Number(await db.getState('auto_budget_prev_used'));
    if (Number.isFinite(prevBase) && Number.isFinite(prevUsed) && prevBase >= remaining) {
      const measured = prevBase - remaining - prevUsed;
      if (measured >= 0) otherDaily = Math.max(measured, cfg.creditOtherDaily * 0.5); // kiugróan alacsony mérés ellen
    }
    const r = computeDailyBudget({ remaining, now, reserve: cfg.minQuotaRemaining, otherDaily, min: cfg.dailyCreditMin, max: cfg.dailyCreditMax });
    budget = r.budget;
    info = `maradt ${remaining}, tartalék ${cfg.minQuotaRemaining}, mások ~${Math.round(otherDaily)}/nap, ${r.days} nap a nullázásig`;
    await db.setState('auto_budget_base', String(remaining));
  }
  await db.setState('auto_budget_key', key);
  await db.setState('auto_budget_value', String(budget));
  log(`Mai automatikus kreditkeret: ${budget} (${info}).`);
  return { budget };
}
