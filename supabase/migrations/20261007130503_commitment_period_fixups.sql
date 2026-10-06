-- Correcting a member's join or commitment end date (the Membership
-- Officer's person page, admin_update_person) removes the commitment
-- periods that no longer fit the new dates (owner, 6 Oct 2026).
--
-- Only periods nobody has started on are removed: review_progress
-- 'Not Started', no member/sponsor/officer submission, and no step,
-- signature or file attached. A period with a review under way is kept,
-- whatever its dates.
--
-- Deliberately limited to this correction path: ensure_commitment_periods
-- and the people_commitment_periods trigger (imports, Approve, any other
-- date write) are unchanged and still only add and re-date periods.

-- The periods ensure_commitment_periods makes for these dates: the same
-- loop, as rows. Keep the two in step.
create function public.commitment_schedule(p_join date, p_end date)
returns table (year_no integer, period_start date, period_end date)
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer := 1;
  s date;
  e date;
  nxt date;
begin
  if p_join is null or p_end is null or p_end <= p_join then
    return;
  end if;
  loop
    s := (p_join + make_interval(years => n - 1))::date;
    exit when s >= p_end or n > 30;
    nxt := (p_join + make_interval(years => n))::date;
    e := nxt - 1;
    if e >= p_end or (nxt + interval '3 months')::date > p_end then
      e := p_end;
    end if;
    year_no := n;
    period_start := s;
    period_end := e;
    return next;
    exit when e >= p_end;
    n := n + 1;
  end loop;
end;
$$;

-- Removes this person's untouched periods that aren't in the schedule for
-- their current dates. Does nothing while either date is blank. Answers how
-- many were removed.
create function public.prune_commitment_periods(p_person uuid) returns integer
language plpgsql
set search_path = ''
as $$
declare
  j date;
  ced date;
  n integer;
begin
  select join_date, commitment_end_date into j, ced from public.people where id = p_person;
  if j is null or ced is null or ced <= j then
    return 0;
  end if;
  delete from public.commitments c
  where c.person_id = p_person
    and c.review_progress = 'Not Started'
    and c.member_submitted_at is null and c.sponsor_submitted_at is null and c.officer_submitted_at is null
    and not exists (select 1 from public.steps x where x.commitment_id = c.id)
    and not exists (select 1 from public.signatures x where x.commitment_id = c.id)
    and not exists (select 1 from public.files x where x.commitment_id = c.id)
    and not exists (select 1 from public.commitment_schedule(j, ced) s
                    where s.year_no = c.year_no and s.period_start = c.period_start and s.period_end = c.period_end);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- admin_update_person as in 20261007010103, plus the pruning above; the
-- answer gains removedPeriods, and 'commitments' joins the logged fields
-- when any were removed.
create or replace function public.admin_update_person(
  p_person text, p_actor text, p_action text, p_patch jsonb, p_expect jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  allowed constant text[] := array[
    'member_type', 'category_type', 'membership_no', 'join_date', 'commitment_end_date',
    'status', 'applicant_stage', 'applicant_type',
    'registered_team', 'selected_team_sos', 'selected_team_eos', 'playing_position',
    'registered_name', 'is_visiting_player'];
  v_id uuid;
  v_actor uuid;
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  k text;
  v_pruned integer := 0;
begin
  if p_action is null or p_action !~ '^admin-[a-z]+(-[a-z]+)*$' then
    raise exception 'action must be admin-...' using errcode = '22023';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  if p_expect is not null and jsonb_typeof(p_expect) <> 'object' then
    raise exception 'expect must be an object' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_patch) union select jsonb_object_keys(coalesce(p_expect, '{}'::jsonb)) loop
    if not (k = any (allowed)) then
      raise exception 'Column % cannot be changed here', k using errcode = '42501';
    end if;
  end loop;

  v_id := public.person_uuid(p_person);
  v_actor := case when p_actor is null then null else public.person_uuid(p_actor) end;

  select to_jsonb(p) into v_old from public.people p where p.id = v_id for update;
  for k in select jsonb_object_keys(coalesce(p_expect, '{}'::jsonb)) loop
    if nullif(v_old ->> k, '') is distinct from nullif(p_expect ->> k, '') then
      return jsonb_build_object('status', 'conflict', 'field', k);
    end if;
  end loop;

  update public.people p set
    member_type = case when p_patch ? 'member_type' then nullif(btrim(p_patch ->> 'member_type'), '') else p.member_type end,
    category_type = case when p_patch ? 'category_type' then nullif(btrim(p_patch ->> 'category_type'), '') else p.category_type end,
    membership_no = case when p_patch ? 'membership_no' then nullif(btrim(p_patch ->> 'membership_no'), '') else p.membership_no end,
    join_date = case when p_patch ? 'join_date' then nullif(p_patch ->> 'join_date', '')::date else p.join_date end,
    commitment_end_date = case when p_patch ? 'commitment_end_date' then nullif(p_patch ->> 'commitment_end_date', '')::date else p.commitment_end_date end,
    status = case when p_patch ? 'status' then nullif(p_patch ->> 'status', '') else p.status end,
    applicant_stage = case when p_patch ? 'applicant_stage' then nullif(p_patch ->> 'applicant_stage', '') else p.applicant_stage end,
    applicant_type = case when p_patch ? 'applicant_type' then nullif(p_patch ->> 'applicant_type', '') else p.applicant_type end,
    registered_team = case when p_patch ? 'registered_team' then nullif(p_patch ->> 'registered_team', '') else p.registered_team end,
    selected_team_sos = case when p_patch ? 'selected_team_sos' then nullif(p_patch ->> 'selected_team_sos', '') else p.selected_team_sos end,
    selected_team_eos = case when p_patch ? 'selected_team_eos' then nullif(p_patch ->> 'selected_team_eos', '') else p.selected_team_eos end,
    playing_position = case when p_patch ? 'playing_position' then nullif(p_patch ->> 'playing_position', '') else p.playing_position end,
    registered_name = case when p_patch ? 'registered_name' then nullif(btrim(p_patch ->> 'registered_name'), '') else p.registered_name end,
    is_visiting_player = case when p_patch ? 'is_visiting_player' then coalesce((p_patch ->> 'is_visiting_player')::boolean, false) else p.is_visiting_player end
  where p.id = v_id
  returning to_jsonb(p.*) into v_new;

  select coalesce(array_agg(c.col order by c.col), '{}') into v_changed
  from (select jsonb_object_keys(p_patch) as col union select 'status') c
  where (v_old -> c.col) is distinct from (v_new -> c.col);

  -- A corrected join or end date: the people_commitment_periods trigger has
  -- already re-dated the untouched periods and added any new ones; drop the
  -- untouched ones that no longer fit.
  if v_changed && array['join_date', 'commitment_end_date'] then
    v_pruned := public.prune_commitment_periods(v_id);
    if v_pruned > 0 then
      v_changed := v_changed || 'commitments'::text;
    end if;
  end if;

  if cardinality(v_changed) > 0 then
    insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
    values (v_actor, p_action, 'people', v_id, v_changed);
    perform set_config('eddy.audit_written', 'on', true);
  end if;
  return jsonb_build_object('status', 'ok', 'changed', to_jsonb(v_changed), 'removedPeriods', v_pruned);
end;
$$;

revoke all on function public.commitment_schedule(date, date), public.prune_commitment_periods(uuid) from public, anon, authenticated;
grant execute on function public.commitment_schedule(date, date), public.prune_commitment_periods(uuid) to service_role;
