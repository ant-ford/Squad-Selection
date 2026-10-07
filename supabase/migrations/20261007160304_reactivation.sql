-- Ask to be reactivated (6 Oct 2026 review, item D2; owner: every Active
-- Section Captain gets the task, and the first answer closes it for all).
--
-- A signed-in member whose record isn't Active used to get a mailto link,
-- and nobody was told. Now "Ask to be reactivated" opens one step per
-- Section Captain (process 'reactivation'), shown in their My Tasks; Activate
-- or Not now closes every copy. Eddy sends no email about it.

alter table public.steps drop constraint steps_process_check;
alter table public.steps add constraint steps_process_check
  check (process in ('new_joiner', 'commitment_review', 'reactivation'));

-- One open request per person.
create unique index steps_one_open_reactivation_idx on public.steps (person_id, waiting_on_person_id)
  where process = 'reactivation' and done_at is null;

-- Everyone who is a Section Captain: by an Active office or a team link,
-- the two ways auth.ts recognises one.
create function public.section_captain_ids() returns setof uuid
language sql stable
set search_path = ''
as $$
  select person_id from public.offices where role = 'section_captain' and status = 'Active' and person_id is not null
  union
  select person_id from public.team_people where role = 'section_captain'
$$;

-- The request, from the signed-in email. Returns {status, askedAt}:
--   'asked'    the request was made now (or was already open: askedAt then)
--   'active'   the record is Active already
--   'nobody'   no People record has this email (they can register to join)
--   'no-captains'  no Section Captain to ask
create function public.request_reactivation(p_email text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_person public.people;
  v_open timestamptz;
  v_n integer;
begin
  select * into v_person from public.people where lower(email) = lower(btrim(p_email));
  if not found then
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

-- Whether this email has a request open: {askedAt} or {askedAt: null}.
create function public.reactivation_status(p_email text) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object('askedAt', (
    select min(s.started_at) from public.steps s
    join public.people p on p.id = s.person_id
    where s.process = 'reactivation' and s.done_at is null and lower(p.email) = lower(btrim(p_email))))
$$;

-- A Section Captain's answer. p_actor is their api id, and the step must be
-- one of theirs. Activate sets Active (the inactive stamp clears as usual);
-- either answer closes every captain's copy. Returns {status}:
--   'activated' | 'declined' | 'closed' (someone answered first)
-- Errors: P0002 not found / not theirs.
create function public.answer_reactivation(p_step uuid, p_actor text, p_activate boolean) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := public.person_uuid(p_actor);
  v_step public.steps;
begin
  select * into v_step from public.steps
  where id = p_step and process = 'reactivation' and waiting_on_person_id = v_actor
  for update;
  if not found then
    raise exception 'No such request' using errcode = 'P0002';
  end if;
  if v_step.done_at is not null then
    return jsonb_build_object('status', 'closed');
  end if;
  if p_activate then
    update public.people set active = true where id = v_step.person_id;
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

revoke all on function public.section_captain_ids(), public.request_reactivation(text), public.reactivation_status(text),
  public.answer_reactivation(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.section_captain_ids(), public.request_reactivation(text), public.reactivation_status(text),
  public.answer_reactivation(uuid, text, boolean) to service_role;
