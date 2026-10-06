-- Officers' edits to a person (the People admin screens; worker/src/admin/).
--
-- admin_update_person() is the one way those screens change a People row:
-- the update and its activity_log row in one transaction. The log holds the
-- column NAMES that changed, never their values. It also sets the
-- transaction-local flag eddy.audit_written, so a later generic audit
-- trigger can see the change is already logged and skip it.
--
-- p_patch: {column: value} for the columns below only (anything else is
-- refused, 42501). '' and null both clear a column.
-- p_expect: {column: value as the screen last read it}. If any differs now
-- (someone else saved meanwhile), nothing is written and the answer is
-- {status: 'conflict', field}. Compared as text, '' the same as null.
--
-- Answers {status: 'ok', changed: [column, ...]}. status is reported when it
-- changed even if it wasn't in the patch: people_accept_status turns an
-- Applicant moved to Temporary into a Member.
create function public.admin_update_person(
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

  if cardinality(v_changed) > 0 then
    insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
    values (v_actor, p_action, 'people', v_id, v_changed);
    perform set_config('eddy.audit_written', 'on', true);
  end if;
  return jsonb_build_object('status', 'ok', 'changed', to_jsonb(v_changed));
end;
$$;

revoke all on function public.admin_update_person(text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.admin_update_person(text, text, text, jsonb, jsonb) to service_role;
