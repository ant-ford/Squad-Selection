-- Confirming kit hand-overs (owner decision, 2026-10-01): when someone
-- passes a kit set on, it isn't recorded as moved until the person they gave
-- it to confirms they've got it. The Kit Convenor's and Section Captains'
-- hand-outs (the collector is in front of them) and a player taking their
-- own set still happen at once.

alter table public.kit_sets
  add column pending_to_id uuid references public.people (id) on delete set null,
  add column pending_since timestamptz;
create index kit_sets_pending_idx on public.kit_sets (pending_to_id) where pending_to_id is not null;

alter table public.kit_moves drop constraint kit_moves_kind_check;
alter table public.kit_moves add constraint kit_moves_kind_check
  check (kind in ('handed', 'delivered', 'returned', 'allocated', 'released', 'edited', 'offered', 'declined'));

create or replace view public.kit_sets_v with (security_invoker = true) as
  select s.id, s.order_id, o.supplier, o.name as order_name, o.ordered_on, o.received_on,
         n.shirt_no, n.team_range, s.ordered_for_name,
         s.shirt, s.shorts, s.socks, s.goalie_smock, s.goalie_smock_style,
         owner.api_id as owner_id, public.kit_person_name(owner) as owner_name,
         holder.api_id as holder_id, public.kit_person_name(holder) as holder_name, s.held_since, s.updated_at,
         num.api_id as number_holder_id, public.kit_person_name(num) as number_holder_name,
         num.status as number_holder_status, num.active as number_holder_active,
         pend.api_id as pending_to_id, public.kit_person_name(pend) as pending_to_name, s.pending_since
  from public.kit_sets s
  join public.kit_orders o on o.id = s.order_id
  join public.shirt_numbers n on n.id = s.shirt_number_id
  left join public.people num on num.shirt_number_id = s.shirt_number_id
  left join public.people owner on owner.id = num.id and owner.active
  left join public.people holder on holder.id = s.holder_id
  left join public.people pend on pend.id = s.pending_to_id;

-- A move now also returns "offered": sets waiting for the receiver to confirm.
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
  offered uuid[] := '{}';
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
    select k.id, k.holder_id, k.pending_to_id, n.shirt_no, o.received_on, owner.id as owner_id, h.api_id as holder_api
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
    -- A holder passing a set to someone else only offers it: it moves when
    -- they confirm they've got it (kit_confirm). Officers' moves, and anyone
    -- taking their own set, happen at once.
    if not p_officer and target is distinct from actor then
      if s.pending_to_id is not distinct from target then
        offered := offered || s.id;
        continue;
      end if;
      update public.kit_sets set pending_to_id = target, pending_since = now() where id = s.id;
      insert into public.kit_moves (set_id, kind, from_id, to_id, by_id) values (s.id, 'offered', s.holder_id, target, actor);
      offered := offered || s.id;
      continue;
    end if;
    if s.holder_id is not distinct from target then
      if s.pending_to_id is not null then
        update public.kit_sets set pending_to_id = null, pending_since = null where id = s.id;
      end if;
      moved := moved || s.id;
      continue;
    end if;
    update public.kit_sets set holder_id = target, held_since = case when target is null then null else now() end,
      pending_to_id = null, pending_since = null
    where id = s.id;
    insert into public.kit_moves (set_id, kind, from_id, to_id, by_id)
    values (s.id, case when target is null then 'returned' when target = s.owner_id then 'delivered' else 'handed' end,
            s.holder_id, target, actor);
    moved := moved || s.id;
  end loop;

  -- Sets asked for that don't exist.
  conflicts := conflicts || coalesce((
    select jsonb_agg(jsonb_build_object('id', x, 'shirtNo', null, 'reason', 'not found'))
    from unnest(p_sets) x where not exists (select 1 from public.kit_sets k where k.id = x)), '[]');
  return jsonb_build_object('moved', to_jsonb(moved), 'offered', to_jsonb(offered), 'conflicts', conflicts);
end;
$$;

-- The receiver of an offered set: "Yes, I've got it" (p_accept) moves it to
-- them; "Not yet" leaves it with the holder. Errors: P0002, 22023.
create function public.kit_confirm(p_actor text, p_set uuid, p_accept boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  actor uuid;
  k public.kit_sets;
  owner uuid;
begin
  select id into actor from public.people where api_id = p_actor;
  if actor is null then raise exception 'Your People record was not found' using errcode = 'P0002'; end if;
  select * into k from public.kit_sets where id = p_set for update;
  if k.id is null then raise exception 'That kit set was not found' using errcode = 'P0002'; end if;
  if k.pending_to_id is distinct from actor then
    raise exception 'That set isn''t waiting for you to confirm' using errcode = '22023';
  end if;
  select p.id into owner from public.people p where p.shirt_number_id = k.shirt_number_id and p.active;
  if p_accept then
    update public.kit_sets set holder_id = actor, held_since = now(), pending_to_id = null, pending_since = null where id = k.id;
    insert into public.kit_moves (set_id, kind, from_id, to_id, by_id)
    values (k.id, case when actor = owner then 'delivered' else 'handed' end, k.holder_id, actor, actor);
  else
    update public.kit_sets set pending_to_id = null, pending_since = null where id = k.id;
    insert into public.kit_moves (set_id, kind, from_id, to_id, by_id, note) values (k.id, 'declined', k.holder_id, actor, actor, 'not received yet');
  end if;
end;
$$;
revoke all on function public.kit_confirm(text, uuid, boolean) from public, anon, authenticated;
