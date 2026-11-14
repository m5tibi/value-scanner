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
      return r.rowCount > 0 ? Number(r.rows[0].id) : null; // az új jelzés azonosítója (igaz-szerű), vagy null
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

    /** A következő nyilvános sorszám (1-től). A kizárt jelzések számát sem használjuk újra:
     *  a csatornán egyszer már kiment szám nem ismétlődhet (2026-11-14: kétszer jelent meg a #15). */
    async nextPublicNo() {
      const r = await pool.query(`select coalesce(max(public_no), 0) + 1 as n from value_signals`);
      return Number(r.rows[0].n);
    },

    /** Ment-e már ki nyilvános jelzés erre a meccsre (bármely piacon / kimenetelen)? Ha igen, azt adja vissza. */
    async publicForEvent(eventId) {
      const r = await pool.query(
        `select id, public_no, market, group_key, outcome_name from value_signals
          where event_id = $1 and public_posted_at is not null and not excluded order by public_posted_at limit 1`, [eventId]);
      return r.rows[0] ?? null;
    },

    async markPublic(id, stake, no) {
      await pool.query(`update value_signals set public_posted_at = now(), public_stake = $2, public_no = $3 where id = $1`, [id, stake, no]);
    },

    /** A jelzés nyilvános sorszáma, vagy null, ha nem ment ki nyilvánosan. */
    async isPublic(id) {
      const r = await pool.query(`select public_no, public_posted_at from value_signals where id = $1`, [id]);
      const x = r.rows[0];
      return x?.public_posted_at ? (Number(x.public_no) || true) : null;
    },

    /** A [start, end) között kezdődött, nyilvánosan kiküldött jelzések. */
    async publicSignalsBetween(start, end) {
      const r = await pool.query(
        `select * from value_signals where public_posted_at is not null and not excluded
           and commence_time >= $1 and commence_time < $2 order by commence_time, id`, [start, end]);
      return r.rows;
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
      const where = `where detected_at > now() - ($1 || ' days')::interval and not excluded`;
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

    /** OddsHub-formátumú (Tippmix/TPro Value) jelzés naplózása. */
    async insertOddsHub({ channelId, channel, msgId, sig, a }) {
      await pool.query(
        `insert into oddshub_signals
           (channel_id, msg_id, channel, posted_at, sport, league, home, away, start_at, market, pin_line, alt_line,
            pin_odds, pin_prev, soft_book, soft_line, soft_odds, pick, to_bet, value_odds, fair_odds, threshold, min_odds,
            edge, estimated, their_ev, their_stake, verdict, warnings)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
         on conflict (channel_id, msg_id) do nothing`,
        [channelId, msgId, channel, sig.postedAt, sig.sport, sig.league, sig.home, sig.away, sig.startAt, sig.market.type,
          sig.market.line, sig.market.alt, sig.pin.map((x) => x.odds), sig.pin.map((x) => x.prev), sig.soft.book, sig.soft.line,
          sig.soft.odds, sig.pick, a.toBet, a.softOdds ?? null, a.fairOdds ?? null, a.consThreshold ?? null, a.minOdds ?? null,
          a.edge ?? null, a.estimated ?? false, sig.theirEv, sig.theirStake, a.verdict, a.warnings]);
    },

    async markOhNotified(channelId, msgId) {
      await pool.query(`update oddshub_signals set notified_at = now() where channel_id = $1 and msg_id = $2`, [channelId, msgId]);
    },

    async ohPendingNotified(windowMin = 20) {
      const r = await pool.query(
        `select * from oddshub_signals
          where notified_at is not null and live_reminded_at is null
            and start_at > now() - ($1 || ' minutes')::interval
          order by posted_at`, [windowMin]);
      return r.rows;
    },

    /** keys: ["<channel_id>:<msg_id>", ...] */
    async ohMarkReminded(keys) {
      for (const k of keys) {
        const [ch, id] = k.split(':');
        await pool.query(`update oddshub_signals set live_reminded_at = now() where channel_id = $1 and msg_id = $2`, [ch, id]);
      }
    },

    /** 🔁/↔️ rögzítése a későbbi kiértékeléshez (kind: 'sf' | 'oh'). */
    async setConfirmation(kind, { channelId, msgId }, { confirmedBy, contradictedBy }) {
      if (!confirmedBy && !contradictedBy) return;
      if (kind === 'sf') {
        await pool.query(`update sportfolio_signals set confirmed_by = $2, contradicted_by = $3 where msg_id = $1`,
          [msgId, confirmedBy, contradictedBy]);
      } else {
        await pool.query(`update oddshub_signals set confirmed_by = $3, contradicted_by = $4 where channel_id = $1 and msg_id = $2`,
          [channelId, msgId, confirmedBy, contradictedBy]);
      }
    },

    /** Adatforrás-teszt eredménye */
    async insertProbe(x) {
      await pool.query(
        `insert into probe_results (channel_id, msg_id, provider, sport, league, home, away, start_at, market, line,
           sig_pin_odds, sig_soft_odds, soft_book, found, provider_event, provider_home, provider_away, provider_league,
           bookmakers, pin_odds, pin_match, soft_found, soft_match, soft_changed_at, calls, error, details, raw)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
        [x.channelId, x.msgId, x.provider, x.sig.sport, x.sig.league, x.sig.home, x.sig.away, x.sig.startAt, x.sig.market.type,
          x.sig.market.line, x.sig.pin.map((p) => p.odds), x.a?.softOdds ?? null, x.sig.soft.book, !!x.found, x.event ?? null,
          x.home ?? null, x.away ?? null, x.league ?? null, x.bookmakers ?? null, x.pinOdds?.map(Number) ?? null,
          x.pinMatch ?? null, x.softFound ?? null, x.softMatch ?? null, x.softChangedAt ?? null, x.calls ?? null,
          x.error ?? null, x.details ? JSON.stringify(x.details) : null, x.raw ?? null]);
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
