-- Re-registrations an officer resolves (Data checks; Track B design §8).
--
-- auto_reregister (20261003090000) records a 'needs_review' event, and
-- changes nothing, when a player is over his play-up allowance but the move
-- can't be worked out safely: a team with no rank, or a destination that
-- would not be a move up. The Men's Convenor or a Section Captain resolves
-- it from Data checks (POST /api/admin/registration-events/:id/resolve):
--
--  - move: registers him to a higher team, exactly as an automatic move
--    would have. people.registered_team changes and the event becomes
--    'applied' with that new_team, so the HKHA registration screen lists
--    him as "Moved up after play-ups" (worker/src/registration.ts reads
--    applied events) and his play-ups count afresh from the new team.
--  - keep: leaves him on his team. The event becomes 'kept' and stays, so
--    auto_reregister does not raise it again this season for that team
--    (it acts once per player, season and team moved from).
--
-- Either way the event records who resolved it and when, and an
-- activity_log row (field names only) is written in the same transaction.

alter table public.registration_events drop constraint registration_events_status_check;
alter table public.registration_events add constraint registration_events_status_check
  check (status in ('applied', 'needs_review', 'kept'));
alter table public.registration_events
  add column resolved_by uuid references public.people (id) on delete set null,
  add column resolved_at timestamptz;
create index registration_events_resolved_by_idx on public.registration_events (resolved_by);

-- Returns {status: 'ok', team} or {status: 'conflict', code}:
--   ALREADY_RESOLVED  the event is not at needs_review any more
--   OLD_SEASON        a move for an event from an earlier season
--   TEAM_CHANGED      his registered team is no longer the one he'd move from
--   NOT_A_MOVE_UP     the team does not outrank the one he'd move from
-- Unknown event: P0002. Bad action or team: 22023.
create function public.resolve_registration_event(p_event uuid, p_action text, p_team text, p_actor text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := case when p_actor is null then null else public.person_uuid(p_actor) end;
  e public.registration_events%rowtype;
  v_current text;
  v_from integer;
  v_to integer;
begin
  select * into e from public.registration_events where id = p_event for update;
  if not found then
    raise exception 'No registration event %', p_event using errcode = 'P0002';
  end if;
  if e.status <> 'needs_review' then
    return jsonb_build_object('status', 'conflict', 'code', 'ALREADY_RESOLVED');
  end if;

  if p_action = 'keep' then
    update public.registration_events
       set status = 'kept', resolved_by = v_actor, resolved_at = now()
     where id = e.id;
    insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
    values (v_actor, 'admin-reregistration-keep', 'people', e.person_id, array['registration_events.status']);

  elsif p_action = 'move' then
    if e.season <> public.current_season() then
      return jsonb_build_object('status', 'conflict', 'code', 'OLD_SEASON');
    end if;
    -- Locked, so a match card arriving now can't move him at the same time.
    select registered_team into v_current from public.people where id = e.person_id for update;
    if v_current is distinct from e.previous_team then
      return jsonb_build_object('status', 'conflict', 'code', 'TEAM_CHANGED');
    end if;
    select team_rank into v_to from public.teams
     where team_name = p_team and team_rank is not null and active is not false;
    if v_to is null then
      raise exception 'No ranked team %', p_team using errcode = '22023';
    end if;
    select team_rank into v_from from public.teams where team_name = e.previous_team;
    -- Never a demotion (rank 1 is the top team). With no rank for the team
    -- he'd move from, any other team is accepted.
    if p_team = e.previous_team or (v_from is not null and v_to >= v_from) then
      return jsonb_build_object('status', 'conflict', 'code', 'NOT_A_MOVE_UP');
    end if;
    update public.people set registered_team = p_team where id = e.person_id;
    update public.registration_events
       set status = 'applied', new_team = p_team, resolved_by = v_actor, resolved_at = now()
     where id = e.id;
    insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
    values (v_actor, 'admin-reregistration-move', 'people', e.person_id,
            array['registered_team', 'registration_events.status']);

  else
    raise exception 'action must be move or keep' using errcode = '22023';
  end if;

  -- This transaction wrote its own activity_log row: generic audit triggers skip it.
  perform set_config('eddy.audit_written', 'on', true);
  return jsonb_build_object('status', 'ok', 'team', case when p_action = 'move' then p_team else e.previous_team end);
end;
$$;
revoke all on function public.resolve_registration_event(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_registration_event(uuid, text, text, text) to service_role;
