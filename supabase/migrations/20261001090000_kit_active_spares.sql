-- Kit goes only to Active players (owner decision, 2026-10-01). A set whose
-- number is held by someone who isn't Active is a spare: nobody's numbers
-- change until a spare is given to a joiner, when the number moves to them.
--  - kit_sets_v: owner_* is the Active holder of the number only; the
--    number_holder_* columns name whoever holds it, Active or not;
--  - kit_move, kit_allocate and kit_release follow the same rule;
--  - kit_allocate only gives kit to Active players.

create or replace view public.kit_sets_v with (security_invoker = true) as
  select s.id, s.order_id, o.supplier, o.name as order_name, o.ordered_on, o.received_on,
         n.shirt_no, n.team_range, s.ordered_for_name,
         s.shirt, s.shorts, s.socks, s.goalie_smock, s.goalie_smock_style,
         owner.api_id as owner_id, public.kit_person_name(owner) as owner_name,
         holder.api_id as holder_id, public.kit_person_name(holder) as holder_name, s.held_since, s.updated_at,
         num.api_id as number_holder_id, public.kit_person_name(num) as number_holder_name,
         num.status as number_holder_status, num.active as number_holder_active
  from public.kit_sets s
  join public.kit_orders o on o.id = s.order_id
  join public.shirt_numbers n on n.id = s.shirt_number_id
  left join public.people num on num.shirt_number_id = s.shirt_number_id
  left join public.people owner on owner.id = num.id and owner.active
  left join public.people holder on holder.id = s.holder_id;

create or replace function public.kit_move(p_actor text, p_officer boolean, p_sets uuid[], p_to text, p_expected jsonb)
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
    left join public.people owner on owner.shirt_number_id = k.shirt_number_id and owner.active
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

create or replace function public.kit_allocate(p_actor text, p_set uuid, p_person text)
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
  was_holder public.people;
begin
  select id into actor from public.people where api_id = p_actor;
  select * into person from public.people where api_id = p_person for update;
  if person.id is null then raise exception 'That person was not found' using errcode = 'P0002'; end if;
  if not person.active then raise exception 'Kit only goes to Active players' using errcode = '22023'; end if;
  select * into k from public.kit_sets where id = p_set for update;
  if k.id is null then raise exception 'That kit set was not found' using errcode = 'P0002'; end if;
  select * into was_holder from public.people where shirt_number_id = k.shirt_number_id for update;
  if was_holder.active then
    raise exception 'That set is not a spare: its number belongs to an Active player' using errcode = '22023';
  end if;
  select o.supplier into v_supplier from public.kit_orders o where o.id = k.order_id;
  if person.shirt_number_id is not null and exists (
    select 1 from public.kit_sets x join public.kit_orders o on o.id = x.order_id
    where x.shirt_number_id = person.shirt_number_id and o.supplier = v_supplier) then
    raise exception 'They already have % kit under their number', v_supplier using errcode = '22023';
  end if;
  select shirt_no into old_no from public.shirt_numbers where id = person.shirt_number_id;
  -- The number moves from whoever held it last (not Active) to the joiner.
  if was_holder.id is not null then
    update public.people set shirt_number_id = null where id = was_holder.id;
  end if;
  update public.people set shirt_number_id = k.shirt_number_id where id = person.id;
  insert into public.kit_moves (set_id, kind, from_id, to_id, by_id, note)
  values (k.id, 'allocated', was_holder.id, person.id, actor, concat_ws('; ',
    case when old_no is not null then 'was number ' || old_no end,
    case when was_holder.id is not null then 'number taken from ' || public.kit_person_name(was_holder) || ' (not Active)' end));
  return k;
end;
$$;

create or replace function public.kit_release(p_actor text, p_set uuid)
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
  select id into owner from public.people where shirt_number_id = k.shirt_number_id and active for update;
  if owner is null then raise exception 'That set is already a spare' using errcode = '22023'; end if;
  update public.people set shirt_number_id = null where id = owner;
  insert into public.kit_moves (set_id, kind, from_id, by_id, note) values (k.id, 'released', owner, actor, 'number given up');
  return k;
end;
$$;

-- Swaps one item between two sets (owner decision, 2026-10-01): a player
-- whose shorts or socks size changed after the order takes a spare's in
-- their new size, or swaps with another player who wants theirs. The spare
-- keeps the other one, so every set's sizes stay true. Shirts are printed
-- with the number, so they are never swapped.
-- Errors: P0002 not found (404), 22023 not possible (400).
create function public.kit_swap(p_actor text, p_set uuid, p_other uuid, p_item text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  actor uuid;
  a public.kit_sets;
  b public.kit_sets;
  a_size text;
  b_size text;
  a_no integer;
  b_no integer;
begin
  if p_item not in ('shorts', 'socks', 'goalie_smock') then
    raise exception 'Only shorts, socks and smocks can be swapped' using errcode = '22023';
  end if;
  if p_set = p_other then raise exception 'Choose two different sets' using errcode = '22023'; end if;
  select id into actor from public.people where api_id = p_actor;
  -- Both locked, in a fixed order, so two swaps at once can't deadlock.
  perform 1 from public.kit_sets where id in (p_set, p_other) order by id for update;
  select * into a from public.kit_sets where id = p_set;
  select * into b from public.kit_sets where id = p_other;
  if a.id is null or b.id is null then raise exception 'That kit set was not found' using errcode = 'P0002'; end if;
  if a.order_id <> b.order_id then raise exception 'Both sets must be from the same order' using errcode = '22023'; end if;
  a_size := to_jsonb(a)->>p_item;
  b_size := to_jsonb(b)->>p_item;
  if a_size is not distinct from b_size then raise exception 'They are the same size' using errcode = '22023'; end if;
  select shirt_no into a_no from public.shirt_numbers where id = a.shirt_number_id;
  select shirt_no into b_no from public.shirt_numbers where id = b.shirt_number_id;
  execute format('update public.kit_sets set %I = $1 where id = $2', p_item) using b_size, a.id;
  execute format('update public.kit_sets set %I = $1 where id = $2', p_item) using a_size, b.id;
  insert into public.kit_moves (set_id, kind, by_id, note) values
    (a.id, 'edited', actor, format('%s %s → %s, swapped with #%s', replace(p_item, 'goalie_', ''), coalesce(a_size, '-'), coalesce(b_size, '-'), b_no)),
    (b.id, 'edited', actor, format('%s %s → %s, swapped with #%s', replace(p_item, 'goalie_', ''), coalesce(b_size, '-'), coalesce(a_size, '-'), a_no));
end;
$$;
revoke all on function public.kit_swap(text, uuid, uuid, text) from public, anon, authenticated;
