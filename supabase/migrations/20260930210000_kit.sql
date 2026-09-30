-- Kit in Eddy: what was ordered, where each set is, and the spares.
-- Owner decisions, 2026-09-30:
--  - kit comes in orders from a supplier (Kukri this season, Tsunami before,
--    maybe again); each set is printed with a shirt number, so a set's shirt
--    size can't change, and a player's shirt size goes back to what was
--    ordered for their number;
--  - a set belongs to whoever holds its number (people.shirt_number_id, the
--    number HKHA knows them by). A number with a set and no holder is a
--    spare, kept with its sizes for a joiner who fits it;
--  - captains, and anyone else, may collect sets for others, so Eddy tracks
--    who has each set until it reaches its owner, and the owner can see it;
--  - the kit screens are for the Kit Convenor and the Section Captains.

create table public.kit_orders (
  id uuid primary key default gen_random_uuid(),
  supplier text not null,
  name text not null unique,
  ordered_on date,
  -- Null until the boxes arrive: until then every set in it is "on order".
  received_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger kit_orders_updated_at before update on public.kit_orders
  for each row execute function public.set_updated_at();

create table public.kit_sets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.kit_orders (id) on delete cascade,
  shirt_number_id uuid not null references public.shirt_numbers (id) on delete restrict,
  -- Who it was ordered for, as the order names them. For the record only:
  -- the owner is whoever holds the number now.
  ordered_for_name text,
  ordered_for_id uuid references public.people (id) on delete set null,
  -- The sizes as ordered (or as delivered, where the supplier got one wrong).
  -- A set is home and away shirts, shorts, home and away socks; a goalkeeper's
  -- adds the smock and goalkeeper socks.
  shirt text,
  shorts text,
  socks text,
  goalie_smock text,
  goalie_smock_style text,
  -- Who has it: null is the kit store, once the order has arrived.
  holder_id uuid references public.people (id) on delete set null,
  held_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, shirt_number_id)
);
create index kit_sets_holder_idx on public.kit_sets (holder_id);
create index kit_sets_number_idx on public.kit_sets (shirt_number_id);
create trigger kit_sets_updated_at before update on public.kit_sets
  for each row execute function public.set_updated_at();

-- Every change to a set, so a missing set can be traced.
create table public.kit_moves (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.kit_sets (id) on delete cascade,
  kind text not null check (kind in ('handed', 'delivered', 'returned', 'allocated', 'released', 'edited')),
  -- Holder before and after; null is the kit store.
  from_id uuid references public.people (id) on delete set null,
  to_id uuid references public.people (id) on delete set null,
  by_id uuid references public.people (id) on delete set null,
  note text,
  at timestamptz not null default now()
);
create index kit_moves_set_idx on public.kit_moves (set_id, at desc);

alter table public.kit_orders enable row level security;
alter table public.kit_sets enable row level security;
alter table public.kit_moves enable row level security;
revoke all on public.kit_orders, public.kit_sets, public.kit_moves from public, anon, authenticated;
grant select, insert, update, delete on public.kit_orders, public.kit_sets, public.kit_moves to service_role;

-- A person's name as the app shows it.
create function public.kit_person_name(p public.people) returns text
language sql immutable
set search_path = ''
as $$ select nullif(trim(coalesce(nullif(p.preferred_name, ''), p.given_names, '') || ' ' || coalesce(p.surname, '')), '') $$;

-- Each set with its number, order, owner and holder, by api_id as the Worker
-- names people.
create view public.kit_sets_v with (security_invoker = true) as
  select s.id, s.order_id, o.supplier, o.name as order_name, o.ordered_on, o.received_on,
         n.shirt_no, n.team_range, s.ordered_for_name,
         s.shirt, s.shorts, s.socks, s.goalie_smock, s.goalie_smock_style,
         owner.api_id as owner_id, public.kit_person_name(owner) as owner_name,
         holder.api_id as holder_id, public.kit_person_name(holder) as holder_name, s.held_since, s.updated_at
  from public.kit_sets s
  join public.kit_orders o on o.id = s.order_id
  join public.shirt_numbers n on n.id = s.shirt_number_id
  left join public.people owner on owner.shirt_number_id = s.shirt_number_id
  left join public.people holder on holder.id = s.holder_id;

create view public.kit_moves_v with (security_invoker = true) as
  select m.id, m.set_id, m.kind, f.api_id as from_id, t.api_id as to_id, b.api_id as by_id, m.note, m.at
  from public.kit_moves m
  left join public.people f on f.id = m.from_id
  left join public.people t on t.id = m.to_id
  left join public.people b on b.id = m.by_id;

-- Moves sets to a person (p_to, an api_id) or back to the store (p_to null).
-- Several people may hand kit out at once, so each set is locked and checked
-- against where the caller last saw it (p_expected: set id -> holder api_id,
-- or null for the store); a set that has moved since is reported, not moved.
-- p_officer is decided by the Worker (Kit Convenor or Section Captain): an
-- officer may move any set; anyone else may hand on a set they hold, or
-- take their own.
-- Returns {"moved": [set ids], "conflicts": [{"id", "shirtNo", "reason"}]}.
-- Errors: P0002 not found (404).
create function public.kit_move(p_actor text, p_officer boolean, p_sets uuid[], p_to text, p_expected jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  actor uuid;
  target uuid;
  s record;
  expected text;
  moved uuid[] := '{}';
  conflicts jsonb := '[]';
  holder_name text;
begin
  select id into actor from public.people where api_id = p_actor;
  if actor is null then raise exception 'Your People record was not found' using errcode = 'P0002'; end if;
  if p_to is not null then
    select id into target from public.people where api_id = p_to;
    if target is null then raise exception 'That person was not found' using errcode = 'P0002'; end if;
  end if;

  for s in
    select k.id, k.holder_id, n.shirt_no, o.received_on, owner.id as owner_id, h.api_id as holder_api
    from public.kit_sets k
    join public.kit_orders o on o.id = k.order_id
    join public.shirt_numbers n on n.id = k.shirt_number_id
    left join public.people owner on owner.shirt_number_id = k.shirt_number_id
    left join public.people h on h.id = k.holder_id
    where k.id = any (p_sets)
    order by k.id
    for update of k
  loop
    if s.received_on is null then
      conflicts := conflicts || jsonb_build_object('id', s.id, 'shirtNo', s.shirt_no, 'reason', 'still on order');
      continue;
    end if;
    if coalesce(p_expected, '{}') ? s.id::text then
      expected := p_expected->>s.id::text;
      if expected is distinct from s.holder_api then
        select public.kit_person_name(p) into holder_name from public.people p where p.id = s.holder_id;
        conflicts := conflicts || jsonb_build_object('id', s.id, 'shirtNo', s.shirt_no,
          'reason', case when s.holder_id is null then 'back in the kit store' else 'already with ' || holder_name end);
        continue;
      end if;
    end if;
    if not p_officer and not (s.holder_id is not distinct from actor or s.owner_id is not distinct from actor) then
      conflicts := conflicts || jsonb_build_object('id', s.id, 'shirtNo', s.shirt_no, 'reason', 'not with you');
      continue;
    end if;
    if not p_officer and target is null then
      conflicts := conflicts || jsonb_build_object('id', s.id, 'shirtNo', s.shirt_no, 'reason', 'only the Kit Convenor can take it back');
      continue;
    end if;
    if s.holder_id is not distinct from target then
      moved := moved || s.id;
      continue;
    end if;
    update public.kit_sets set holder_id = target, held_since = case when target is null then null else now() end where id = s.id;
    insert into public.kit_moves (set_id, kind, from_id, to_id, by_id)
    values (s.id, case when target is null then 'returned' when target = s.owner_id then 'delivered' else 'handed' end,
            s.holder_id, target, actor);
    moved := moved || s.id;
  end loop;

  -- Sets asked for that don't exist.
  conflicts := conflicts || coalesce((
    select jsonb_agg(jsonb_build_object('id', x, 'shirtNo', null, 'reason', 'not found'))
    from unnest(p_sets) x where not exists (select 1 from public.kit_sets k where k.id = x)), '[]');
  return jsonb_build_object('moved', to_jsonb(moved), 'conflicts', conflicts);
end;
$$;

-- Gives a spare set to a person: they take its number. A person who already
-- has a number with kit from the same supplier can't take a second.
-- Errors: P0002 not found (404), 22023 not possible (400).
create function public.kit_allocate(p_actor text, p_set uuid, p_person text)
returns public.kit_sets
language plpgsql
set search_path = ''
as $$
declare
  actor uuid;
  person public.people;
  k public.kit_sets;
  v_supplier text;
  old_no integer;
begin
  select id into actor from public.people where api_id = p_actor;
  select * into person from public.people where api_id = p_person for update;
  if person.id is null then raise exception 'That person was not found' using errcode = 'P0002'; end if;
  select * into k from public.kit_sets where id = p_set for update;
  if k.id is null then raise exception 'That kit set was not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.people where shirt_number_id = k.shirt_number_id) then
    raise exception 'That set is not a spare: its number belongs to someone' using errcode = '22023';
  end if;
  select o.supplier into v_supplier from public.kit_orders o where o.id = k.order_id;
  if person.shirt_number_id is not null and exists (
    select 1 from public.kit_sets x join public.kit_orders o on o.id = x.order_id
    where x.shirt_number_id = person.shirt_number_id and o.supplier = v_supplier) then
    raise exception 'They already have % kit under their number', v_supplier using errcode = '22023';
  end if;
  select shirt_no into old_no from public.shirt_numbers where id = person.shirt_number_id;
  update public.people set shirt_number_id = k.shirt_number_id where id = person.id;
  insert into public.kit_moves (set_id, kind, to_id, by_id, note)
  values (k.id, 'allocated', person.id, actor, case when old_no is not null then 'was number ' || old_no end);
  return k;
end;
$$;

-- Makes a set a spare: its owner (an applicant who didn't join, say) gives
-- up the number. Where the set is doesn't change.
create function public.kit_release(p_actor text, p_set uuid)
returns public.kit_sets
language plpgsql
set search_path = ''
as $$
declare
  actor uuid;
  k public.kit_sets;
  owner uuid;
begin
  select id into actor from public.people where api_id = p_actor;
  select * into k from public.kit_sets where id = p_set for update;
  if k.id is null then raise exception 'That kit set was not found' using errcode = 'P0002'; end if;
  select id into owner from public.people where shirt_number_id = k.shirt_number_id for update;
  if owner is null then raise exception 'That set is already a spare' using errcode = '22023'; end if;
  update public.people set shirt_number_id = null where id = owner;
  insert into public.kit_moves (set_id, kind, from_id, by_id, note) values (k.id, 'released', owner, actor, 'number given up');
  return k;
end;
$$;

-- Gives a person without a number the lowest free number in their team's
-- range (Shirt Numbers.team_range; higher teams have the lower numbers). A
-- number with a kit set is never "free": that set is a spare, given with
-- kit_allocate. Returns the number. Errors: P0002, 22023.
create function public.kit_new_number(p_actor text, p_person text, p_team text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  person public.people;
  chosen public.shirt_numbers;
begin
  select * into person from public.people where api_id = p_person for update;
  if person.id is null then raise exception 'That person was not found' using errcode = 'P0002'; end if;
  if person.shirt_number_id is not null then raise exception 'They already have a number' using errcode = '22023'; end if;
  select n.* into chosen from public.shirt_numbers n
  where n.team_range = p_team
    and not exists (select 1 from public.people p where p.shirt_number_id = n.id)
    and not exists (select 1 from public.kit_sets k where k.shirt_number_id = n.id)
  order by n.shirt_no
  limit 1
  for update skip locked;
  if chosen.id is null then raise exception 'No free number left in the % range', p_team using errcode = '22023'; end if;
  update public.people set shirt_number_id = chosen.id where id = person.id;
  return chosen.shirt_no;
end;
$$;

-- Corrects a set's sizes (a supplier's mistake). The shirt is printed with
-- the number, so this is for what actually arrived.
create function public.kit_edit_sizes(p_actor text, p_set uuid, p jsonb)
returns public.kit_sets
language plpgsql
set search_path = ''
as $$
declare
  actor uuid;
  old_set public.kit_sets;
  new_set public.kit_sets;
begin
  select id into actor from public.people where api_id = p_actor;
  select * into old_set from public.kit_sets where id = p_set for update;
  if old_set.id is null then raise exception 'That kit set was not found' using errcode = 'P0002'; end if;
  update public.kit_sets set
    shirt = nullif(btrim(p->>'shirt'), ''),
    shorts = nullif(btrim(p->>'shorts'), ''),
    socks = nullif(btrim(p->>'socks'), ''),
    goalie_smock = nullif(btrim(p->>'goalieSmock'), ''),
    goalie_smock_style = nullif(btrim(p->>'goalieSmockStyle'), '')
  where id = p_set
  returning * into new_set;
  insert into public.kit_moves (set_id, kind, by_id, note)
  values (p_set, 'edited', actor, concat_ws(', ',
    case when old_set.shirt is distinct from new_set.shirt then 'shirt ' || coalesce(old_set.shirt, '-') || ' → ' || coalesce(new_set.shirt, '-') end,
    case when old_set.shorts is distinct from new_set.shorts then 'shorts ' || coalesce(old_set.shorts, '-') || ' → ' || coalesce(new_set.shorts, '-') end,
    case when old_set.socks is distinct from new_set.socks then 'socks ' || coalesce(old_set.socks, '-') || ' → ' || coalesce(new_set.socks, '-') end,
    case when old_set.goalie_smock is distinct from new_set.goalie_smock then 'smock ' || coalesce(old_set.goalie_smock, '-') || ' → ' || coalesce(new_set.goalie_smock, '-') end,
    case when old_set.goalie_smock_style is distinct from new_set.goalie_smock_style then 'smock style ' || coalesce(old_set.goalie_smock_style, '-') || ' → ' || coalesce(new_set.goalie_smock_style, '-') end));
  return new_set;
end;
$$;

revoke all on function public.kit_move(text, boolean, uuid[], text, jsonb) from public, anon, authenticated;
revoke all on function public.kit_allocate(text, uuid, text) from public, anon, authenticated;
revoke all on function public.kit_release(text, uuid) from public, anon, authenticated;
revoke all on function public.kit_new_number(text, text, text) from public, anon, authenticated;
revoke all on function public.kit_edit_sizes(text, uuid, jsonb) from public, anon, authenticated;
