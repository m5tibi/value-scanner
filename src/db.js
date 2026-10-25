import pg from 'pg';
import { readFile } from 'node:fs/promises';

export function makeDb(databaseUrl) {
  if (!databaseUrl) throw new Error('DATABASE_URL hiányzik');
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
    max: 3,
  });

  return {
    pool,
    async migrate() {
      const sql = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
      await pool.query(sql);
    },

    /** Új jelzés; ha ugyanerre a kimenetelre már volt, nem duplikál. Visszatér: true, ha új. */
    async insertSignal(s) {
      const cols = ['event_id', 'sport_key', 'home_team', 'away_team', 'commence_time', 'market', 'group_key',
        'outcome_name', 'point', 'soft_book', 'soft_odds', 'pin_odds', 'pin_margin', 'fair_prob', 'fair_odds',
        'edge', 'min_odds', 'detected_at', 'notified_odds', 'notified_edge', 'notified_book'];
      const vals = cols.map((c) => ({ notified_odds: s.soft_odds, notified_edge: s.edge, notified_book: s.soft_book }[c] ?? s[c]));
      const ph = cols.map((_, i) => `$${i + 1}`).join(',');
      const r = await pool.query(
        `insert into value_signals (${cols.join(',')}) values (${ph})
         on conflict (event_id, market, group_key, outcome_name) do nothing returning id`, vals);
      return r.rowCount > 0;
    },

    /** A még el nem kezdődött jelzéseknél frissíti a "záró" Pinnacle-adatot és a CLV-t. */
    async updateClosing(snap) {
      for (const o of snap.outcomes) {
        await pool.query(
          `update value_signals
              set closing_pin_odds = $5, closing_fair_prob = $6, closing_seen_at = $7,
                  clv = soft_odds * $6 - 1
            where event_id = $1 and market = $2 and group_key = $3 and outcome_name = $4
              and commence_time > $7`,
          [snap.event_id, snap.market, snap.group_key, o.name, o.pin_odds, o.fair_prob, snap.seen_at]);
      }
    },

    /** A már kiküldött jelzés utoljára értesített ára/előnye (a "javult az odds" döntéshez). */
    async getNotified(s) {
      const r = await pool.query(
        `select id, notified_odds, notified_edge, notified_book, improved_count from value_signals
          where event_id = $1 and market = $2 and group_key = $3 and outcome_name = $4`,
        [s.event_id, s.market, s.group_key, s.outcome_name]);
      const x = r.rows[0];
      return x && { id: x.id, odds: x.notified_odds == null ? null : Number(x.notified_odds),
        edge: x.notified_edge == null ? null : Number(x.notified_edge), book: x.notified_book, count: x.improved_count };
    },

    async markImproved(id, s) {
      await pool.query(
        `update value_signals set notified_odds = $2, notified_edge = $3, notified_book = $4,
                improved_count = improved_count + 1 where id = $1`, [id, s.soft_odds, s.edge, s.soft_book]);
    },

    /** Kezdési emlékeztetőre váró jelzések (kezdés elmúlt, legfeljebb windowMin perce). */
    async dueLiveReminders(windowMin = 20) {
      const r = await pool.query(
        `select * from value_signals
          where live_reminded_at is null and commence_time <= now()
            and commence_time > now() - ($1 || ' minutes')::interval
          order by commence_time, id`, [windowMin]);
      return r.rows;
    },

    async markLiveReminded(ids) {
      if (ids.length) await pool.query(`update value_signals set live_reminded_at = now() where id = any($1)`, [ids]);
    },

    /** Sportfolio: kiküldöttnek jelöl. */
    async markSfNotified(msgId) {
      await pool.query(`update sportfolio_signals set notified_at = now() where msg_id = $1`, [msgId]);
    },

    /** Sportfolio: a még nem emlékeztetett, kiküldött jelzések (újraindításkor visszatöltéshez). */
    async sfPendingNotified(windowMin = 20) {
      const r = await pool.query(
        `select * from sportfolio_signals
          where notified_at is not null and live_reminded_at is null
            and start_at > now() - ($1 || ' minutes')::interval
          order by posted_at`, [windowMin]);
      return r.rows;
    },

    async sfMarkReminded(msgIds) {
      if (msgIds.length) await pool.query(`update sportfolio_signals set live_reminded_at = now() where msg_id = any($1)`, [msgIds]);
    },

    async openSportsToSettle() {
      const r = await pool.query(
        `select distinct sport_key from value_signals
          where settled_at is null and commence_time < now() - interval '2 hours'
            and commence_time > now() - interval '3 days'`);
      return r.rows.map((x) => x.sport_key);
    },

    async unsettledForEvent(eventId) {
      const r = await pool.query(`select * from value_signals where event_id = $1 and settled_at is null`, [eventId]);
      return r.rows;
    },

    async saveSettlement(id, { home, away, result, profit }) {
      await pool.query(
        `update value_signals set home_score=$2, away_score=$3, result=$4, profit=$5, settled_at=now() where id=$1`,
        [id, home, away, result, profit]);
    },

    async report(days = 30) {
      const where = `where detected_at > now() - ($1 || ' days')::interval`;
      const overall = await pool.query(`
        select count(*)::int as jelzes,
               count(*) filter (where settled_at is not null)::int as elszamolt,
               count(*) filter (where result in ('nyert','fel_nyert'))::int as nyert,
               count(*) filter (where result in ('vesztett','fel_vesztett'))::int as vesztett,
               coalesce(sum(profit),0)::float as profit,
               avg(edge)::float as atlag_elony,
               avg(clv)::float as atlag_clv,
               avg(case when clv is null then null when clv > 0 then 1 else 0 end)::float as pozitiv_clv_arany
          from value_signals ${where}`, [days]);
      const bySport = await pool.query(`
        select sport_key, count(*)::int as n, coalesce(sum(profit),0)::float as profit,
               avg(clv)::float as atlag_clv
          from value_signals ${where} group by sport_key order by n desc`, [days]);
      const byEdge = await pool.query(`
        select case when edge < 0.04 then '2-4%' when edge < 0.07 then '4-7%' else '7-10%' end as sav,
               count(*)::int as n, coalesce(sum(profit),0)::float as profit, avg(clv)::float as atlag_clv
          from value_signals ${where} group by 1 order by 1`, [days]);
      return { overall: overall.rows[0], bySport: bySport.rows, byEdge: byEdge.rows };
    },

    /** Sportfolio-jelzés naplózása (üzenet-ID alapján egyszer). */
    async insertSportfolio({ msgId, sig, a }) {
      await pool.query(
        `insert into sportfolio_signals
           (msg_id, posted_at, sport, league, home, away, period, start_at,
            value_book, value_market, value_odds, ref_book, ref_market, ref_odds,
            to_bet, same_market, threshold, edge, verdict, warnings, category)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         on conflict (msg_id) do nothing`,
        [msgId, sig.postedAt, sig.sport, sig.league, sig.home, sig.away, sig.period, sig.startAt,
          sig.value.book, sig.value.market, sig.value.odds, sig.ref.book, sig.ref.market, sig.ref.odds,
          a.toBet, a.sameMarket, a.threshold, a.edge, a.verdict, a.warnings, a.category ?? null]);
    },

    async getState(key) {
      const r = await pool.query(`select value from value_bot_state where key = $1`, [key]);
      return r.rows[0]?.value ?? null;
    },

    async setState(key, value) {
      await pool.query(
        `insert into value_bot_state (key, value) values ($1, $2)
         on conflict (key) do update set value = excluded.value, updated_at = now()`, [key, value]);
    },

    end: () => pool.end(),
  };
}
