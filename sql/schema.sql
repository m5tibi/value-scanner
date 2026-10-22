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
