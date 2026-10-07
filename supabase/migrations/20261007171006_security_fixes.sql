-- Security review follow-ups (7 Oct 2026, PR #285's findings that need SQL).
--
-- 1. Reactivation is for members only. Anyone not Active could ask, so a
--    self-registered applicant (or someone who resigned) could ask, and an
--    Activate made them a full player without the membership process. They
--    now get 'nobody', which the app answers with "register your interest".
-- 2. Only a current Section Captain can answer a reactivation request. The
--    steps were addressed to the captains at the time of asking, so someone
--    who has since stepped down could still answer. Activating also needs
--    the person to still be a Member.
-- 3. log_client_error counted and then inserted, so reports arriving at the
--    same moment could all pass the hourly limit. A lock per person makes
--    the count and the insert one step.

create or replace function public.request_reactivation(p_email text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_person public.people;
  v_open timestamptz;
  v_n integer;
begin
  select * into v_person from public.people where lower(email) = lower(btrim(p_email));
  -- Members only: applicants join through /join and /apply, and someone who
  -- resigned rejoins the club first.
  if not found or v_person.status is distinct from 'Member' then
    return jsonb_build_object('status', 'nobody');
  end if;
  if v_person.active then
    return jsonb_build_object('status', 'active');
  end if;
  select min(started_at) into v_open from public.steps
  where process = 'reactivation' and person_id = v_person.id and done_at is null;
  if v_open is not null then
    return jsonb_build_object('status', 'asked', 'askedAt', v_open);
  end if;
  insert into public.steps (process, step, person_id, waiting_on_person_id, waiting_on_role)
  select 'reactivation', 'activate', v_person.id, c, 'section_captain'
  from public.section_captain_ids() as c
  where c <> v_person.id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('status', 'no-captains');
  end if;
  insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
  values (v_person.id, 'reactivation-asked', 'people', v_person.id, '{}');
  perform set_config('eddy.audit_written', 'on', true);
  return jsonb_build_object('status', 'asked', 'askedAt', now());
end;
$$;

create or replace function public.answer_reactivation(p_step uuid, p_actor text, p_activate boolean) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := public.person_uuid(p_actor);
  v_step public.steps;
begin
  -- The step must be theirs, and they must still be a Section Captain.
  select * into v_step from public.steps
  where id = p_step and process = 'reactivation' and waiting_on_person_id = v_actor
    and v_actor in (select public.section_captain_ids())
  for update;
  if not found then
    raise exception 'No such request' using errcode = 'P0002';
  end if;
  if v_step.done_at is not null then
    return jsonb_build_object('status', 'closed');
  end if;
  if p_activate then
    update public.people set active = true where id = v_step.person_id and status = 'Member';
    if not found then
      raise exception 'Only a member can be reactivated' using errcode = '22023';
    end if;
  end if;
  update public.steps set done_at = now(), done_by_person_id = v_actor
  where process = 'reactivation' and person_id = v_step.person_id and done_at is null;
  insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
  values (v_actor, case when p_activate then 'reactivated' else 'reactivation-declined' end, 'people', v_step.person_id,
          case when p_activate then array['active'] else '{}'::text[] end);
  perform set_config('eddy.audit_written', 'on', true);
  return jsonb_build_object('status', case when p_activate then 'activated' else 'declined' end);
end;
$$;

create or replace function public.log_client_error(p_person text, p_route text, p_message text, p_detail jsonb, p_limit integer)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  -- One report at a time per person, so the count below can't be raced.
  perform pg_advisory_xact_lock(hashtext('log_client_error:' || coalesce(p_person, '')));
  if (select count(*) from public.error_log
      where source = 'client' and person_id = p_person and at > now() - interval '1 hour') >= p_limit then
    return false;
  end if;
  insert into public.error_log (source, route, message, person_id, detail)
  values ('client', left(p_route, 200), left(p_message, 500), p_person, p_detail);
  return true;
end $$;
