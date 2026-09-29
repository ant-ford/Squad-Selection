-- The squad app's tables: teams, fixtures, selections, appearances,
-- availability and the ranking history. Link fields that held several
-- records in Airtable (team coaches, selected players) become join tables.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  team_name text not null unique,
  -- Team hierarchy comes from here, never from the name (README invariant 10).
  team_rank integer,
  is_premier boolean not null default false,
  team_type text,
  active boolean not null default false,
  target_squad_size integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger teams_updated_at before update on public.teams
  for each row execute function public.set_updated_at();

-- Teams.Coach / Team Captain / Section Captain / Auto Select Players.
-- Coach and Section Captain links are the only source of coach access.
create table public.team_people (
  team_id uuid not null references public.teams (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  role text not null check (role in ('coach', 'team_captain', 'section_captain', 'auto_select')),
  ordinal smallint not null default 1,
  primary key (team_id, role, person_id)
);
create index team_people_person_idx on public.team_people (person_id);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  match_key text,
  fixture_id text,
  match_date timestamptz,
  division text,
  home_team text,
  home_score integer,
  away_team text,
  away_score integer,
  venue text,
  home_kit text check (home_kit in ('Blue', 'White')),
  away_kit text check (away_kit in ('Blue', 'White')),
  ump_1 text,
  ump_2 text,
  match_status text,
  last_hkha_sync timestamptz,
  lock_hkha_sync boolean not null default false,
  auto_select_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index matches_date_idx on public.matches (match_date);
create index matches_status_idx on public.matches (match_status);
create index matches_fixture_idx on public.matches (fixture_id);
create trigger matches_updated_at before update on public.matches
  for each row execute function public.set_updated_at();

-- Selections live with the match (README invariant 6), one row per selected
-- player per side, in the order the coach left them.
create table public.match_selections (
  match_id uuid not null references public.matches (id) on delete cascade,
  side text not null check (side in ('home', 'away')),
  person_id uuid not null references public.people (id) on delete cascade,
  ordinal smallint not null default 1,
  primary key (match_id, side, person_id)
);
create index match_selections_person_idx on public.match_selections (person_id);

-- A Match Card is an appearance record from the HKHA match card. The person
-- link is set on insert by hkha-sync (the "Link Match Cards to People"
-- automation's job); a card whose name matched no one keeps person_id null
-- and its raw name.
create table public.match_cards (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  match_id uuid references public.matches (id) on delete cascade,
  person_id uuid references public.people (id) on delete set null,
  raw_player_name text,
  team text,
  player_team text,
  jersey_number integer,
  goals_scored integer,
  cards text[] not null default '{}',
  captain boolean not null default false,
  -- Per appearance: the only authority for the GK play-up exemption (invariant 9).
  goalkeeper boolean not null default false,
  vp boolean not null default false,
  u21 boolean not null default false,
  fixture_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index match_cards_match_idx on public.match_cards (match_id);
create index match_cards_person_idx on public.match_cards (person_id);
create index match_cards_carded_idx on public.match_cards (match_id) where cards <> '{}';
create trigger match_cards_updated_at before update on public.match_cards
  for each row execute function public.set_updated_at();

-- Exception-based availability (invariant 5): no row means the default.
create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  person_id uuid references public.people (id) on delete cascade,
  match_id uuid references public.matches (id) on delete cascade,
  status text not null check (status in ('Available', 'Maybe', 'Unavailable')),
  player_notes text,
  updated_by_id uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One answer per player per match. Airtable could hold duplicates; the
-- import reports any and keeps the newest.
create unique index availability_exceptions_person_match_key
  on public.availability_exceptions (person_id, match_id);
create index availability_exceptions_match_idx on public.availability_exceptions (match_id);
create index availability_exceptions_updated_by_idx on public.availability_exceptions (updated_by_id);
create trigger availability_exceptions_updated_at before update on public.availability_exceptions
  for each row execute function public.set_updated_at();

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  person_id uuid references public.people (id) on delete cascade,
  rule_type text check (rule_type in ('Play-ups', 'Support games', 'Midweek', 'Date range', 'All future')),
  availability text check (availability in ('Available', 'Maybe', 'Unavailable')),
  active boolean not null default true,
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index availability_rules_person_idx on public.availability_rules (person_id);
create trigger availability_rules_updated_at before update on public.availability_rules
  for each row execute function public.set_updated_at();

create table public.ability_group_config (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  group_name text not null unique,
  capacity integer not null default 0 check (capacity >= 0),
  is_residual boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ability_group_config_updated_at before update on public.ability_group_config
  for each row execute function public.set_updated_at();

create table public.ranking_events (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  person_id uuid references public.people (id) on delete cascade,
  actor_id uuid references public.people (id) on delete set null,
  actor_email text,
  kind text not null check (kind in ('move', 'reorder', 'activate', 'deactivate')),
  old_rank integer,
  new_rank integer,
  justification text check (char_length(justification) <= 280),
  occurred_at timestamptz not null default now()
);
create index ranking_events_occurred_idx on public.ranking_events (occurred_at desc);
create index ranking_events_person_idx on public.ranking_events (person_id);
create index ranking_events_actor_idx on public.ranking_events (actor_id);

-- hkha-sync's bookkeeping, one row per fixture it scrapes.
create table public.hkha_sync_state (
  id uuid primary key default gen_random_uuid(),
  airtable_id text unique,
  fixture_id text,
  match_id uuid references public.matches (id) on delete set null,
  last_scraped timestamptz,
  match_card_imported boolean not null default false,
  last_match_card_refresh timestamptz,
  source_team text,
  sync_status text,
  error_message text,
  refresh_count integer,
  hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hkha_sync_state_fixture_idx on public.hkha_sync_state (fixture_id);
create index hkha_sync_state_match_idx on public.hkha_sync_state (match_id);
create trigger hkha_sync_state_updated_at before update on public.hkha_sync_state
  for each row execute function public.set_updated_at();
