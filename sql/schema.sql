-- Value-szkenner tábla (PostgreSQL / Supabase)
create table if not exists value_signals (
  id                 bigserial primary key,
  event_id           text        not null,
  sport_key          text        not null,
  home_team          text        not null,
  away_team          text        not null,
  commence_time      timestamptz not null,
  market             text        not null,   -- h2h | totals | spreads
  group_key          text        not null,   -- pl. totals@2.5, spreads@-1.5
  outcome_name       text        not null,   -- csapatnév | Draw | Over | Under
  point              numeric,
  soft_book          text        not null,
  soft_odds          numeric     not null,
  pin_odds           numeric     not null,
  pin_margin         numeric,
  fair_prob          numeric     not null,
  fair_odds          numeric     not null,
  edge               numeric     not null,
  min_odds           numeric     not null,
  detected_at        timestamptz not null default now(),

  -- záró vonal (az utolsó Pinnacle-adat kezdés előtt) és CLV
  closing_pin_odds   numeric,
  closing_fair_prob  numeric,
  closing_seen_at    timestamptz,
  clv                numeric,               -- soft_odds * closing_fair_prob - 1

  -- elszámolás (1 egység papíros tét)
  home_score         integer,
  away_score         integer,
  result             text,                  -- nyert | vesztett | visszajár | fel_nyert | fel_vesztett
  profit             numeric,
  settled_at         timestamptz,

  -- saját, valóban megtett fogadás (kézzel kitölthető)
  my_book            text,
  my_odds            numeric,
  my_stake           numeric,

  unique (event_id, market, group_key, outcome_name)
);

create index if not exists value_signals_open_idx on value_signals (commence_time) where settled_at is null;

-- Ütemezett futáshoz: mikor volt utoljára elszámolás és riport
create table if not exists value_bot_state (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

-- Supabase: a public sémában lévő táblák a Data API-n (anon kulccsal) is elérhetők lennének.
-- Az RLS bekapcsolása policy nélkül ezt lezárja; a bot a postgres felhasználóval csatlakozik, rá nem vonatkozik.
alter table value_signals   enable row level security;
alter table value_bot_state enable row level security;

-- Sportfolio-csatorna jelzései (userbot naplózza)
create table if not exists sportfolio_signals (
  msg_id        bigint primary key,
  posted_at     timestamptz not null,
  sport         text,
  league        text,
  home          text,
  away          text,
  period        text,
  start_at      timestamptz,
  value_book    text,
  value_market  text,
  value_odds    numeric,
  ref_book      text,
  ref_market    text,
  ref_odds      numeric,
  to_bet        text,
  same_market   boolean,
  threshold     numeric,
  edge          numeric,
  verdict       text,          -- mehet | ovatosan | kihagy
  warnings      text[],
  -- saját fogadás és eredmény (kézzel kitölthető)
  my_book       text,
  my_odds       numeric,
  my_stake      numeric,
  result        text,
  profit        numeric
);
alter table sportfolio_signals enable row level security;

-- Előny-kategória (normal | nagy_elony | nagyon_nagy_elony) a későbbi kiértékeléshez
alter table sportfolio_signals add column if not exists category text;

-- Követő értesítések: "javult az odds" és kezdési emlékeztető
alter table value_signals add column if not exists notified_odds    numeric;
alter table value_signals add column if not exists notified_edge    numeric;
alter table value_signals add column if not exists notified_book    text;
alter table value_signals add column if not exists improved_count   int not null default 0;
alter table value_signals add column if not exists live_reminded_at timestamptz;
alter table sportfolio_signals add column if not exists notified_at      timestamptz;
alter table sportfolio_signals add column if not exists live_reminded_at timestamptz;

-- "Tippmix Value" / "TPro Value" csatornák jelzései (OddsHub-formátum)
create table if not exists oddshub_signals (
  channel_id    text not null,
  msg_id        bigint not null,
  channel       text,
  posted_at     timestamptz not null,
  sport         text,
  league        text,
  home          text,
  away          text,
  start_at      timestamptz,
  market        text,          -- ml | totals | spread
  pin_line      numeric,
  alt_line      boolean,
  pin_odds      numeric[],
  pin_prev      numeric[],
  soft_book     text,
  soft_line     numeric,
  soft_odds     numeric[],
  pick          int,
  to_bet        text,
  value_odds    numeric,
  fair_odds     numeric,
  threshold     numeric,
  min_odds      numeric,
  edge          numeric,
  estimated     boolean,
  their_ev      numeric,
  their_stake   numeric,
  verdict       text,
  warnings      text[],
  notified_at      timestamptz,
  live_reminded_at timestamptz,
  my_odds       numeric,
  my_stake      numeric,
  result        text,
  profit        numeric,
  primary key (channel_id, msg_id)
);
alter table oddshub_signals enable row level security;

-- Kereszt-megerősítés: melyik másik csatorna jelezte ugyanazt (🔁) vagy az ellenkezőjét (↔️)
alter table sportfolio_signals add column if not exists confirmed_by  text;
alter table sportfolio_signals add column if not exists contradicted_by text;
alter table oddshub_signals    add column if not exists confirmed_by  text;
alter table oddshub_signals    add column if not exists contradicted_by text;

-- Adatforrás-teszt (pinnapi / OddsPapi): megvan-e a jelzés meccse és ára az API-ban
create table if not exists probe_results (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  channel_id    text,
  msg_id        bigint,
  provider      text not null,          -- pinnapi | oddspapi
  sport         text,
  league        text,
  home          text,
  away          text,
  start_at      timestamptz,
  market        text,
  line          numeric,
  sig_pin_odds  numeric[],
  sig_soft_odds numeric,
  soft_book     text,
  found         boolean,
  provider_event text,
  provider_home text,
  provider_away text,
  provider_league text,
  bookmakers    text[],
  pin_odds      numeric[],
  pin_match     boolean,
  soft_found    boolean,
  soft_match    boolean,
  soft_changed_at text,
  calls         int,
  error         text,
  details       jsonb,
  raw           jsonb
);
alter table probe_results enable row level security;

-- Nyilvános (előfizetői) csatorna: mikor és mekkora javasolt téttel ment ki a jelzés
alter table value_signals add column if not exists public_posted_at timestamptz;
alter table value_signals add column if not exists public_stake     numeric;

-- Nyilvános sorszám (#1, #2, …) – külön a belső azonosítótól
alter table value_signals add column if not exists public_no int;
-- Egyszeri visszamenőleges számozás: a már kiküldött nyilvános tippek a kiküldés sorrendjében kapnak számot
update value_signals v set public_no = sub.rn
  from (select id, row_number() over (order by public_posted_at, id) as rn from value_signals where public_posted_at is not null) sub
 where v.id = sub.id
   and not exists (select 1 from value_signals where public_no is not null);

-- Kizárt (hibás) jelzések: nem számítanak a riportokba és a nyilvános statisztikába
alter table value_signals add column if not exists excluded boolean not null default false;
alter table value_signals add column if not exists exclude_reason text;
-- 2026-11-13: kétesélyes Pinnacle vs. háromesélyes soft h2h (kézilabda) – és minden olyan eset, ahol
-- ugyanarra a meccsre és piacra két különböző kimenetel is jelzés lett
update value_signals v set excluded = true, exclude_reason = 'h2h 2-esélyes vs 3-esélyes / mindkét oldal'
 where not v.excluded and exists (
   select 1 from value_signals o
    where o.event_id = v.event_id and o.market = v.market and o.group_key = v.group_key and o.outcome_name <> v.outcome_name);
-- 2026-11-13: a kizárt #6/#7 helyére a #8 lép (#6), hogy a csatorna számozása folyamatos legyen.
-- Csak akkor fut, ha a 6-os és 7-es szám még szabad (nem kizárt jelzés nem használja).
update value_signals set public_no = 6
 where public_no = 8 and not excluded
   and not exists (select 1 from value_signals where public_no in (6, 7) and not excluded);
-- 2026-11-14: a #9 (Szlovénia–Svájc) a javítás előtt kapta a számát; #7 lesz, hogy a csatorna folyamatos maradjon.
update value_signals set public_no = 7
 where public_no = 9 and not excluded
   and not exists (select 1 from value_signals where public_no in (7, 8) and not excluded);
