-- Change history (6 Oct 2026 review, track C; design in
-- docs/design/HISTORY_AND_NOTICES.md, owner decisions 6 Oct 2026).
--
-- Officers' own screens already log what they do, from inside their SQL
-- functions (admin_update_person and friends), and set the transaction-local
-- flag eddy.audit_written. Squad saves record every add and remove in
-- match_selection_changes. What logged nothing: kit colours, auto-select, a
-- coach's priority players, Opt-In Only, teams and positions changed outside
-- the admin screens, fixture changes from hkha-sync, offices edited in the
-- Table Editor, and a coach answering for a player. This adds one generic
-- trigger for those.
--
-- Who did it: the Worker sends the signed-in person's uuid as the
-- x-eddy-actor request header on every database call; PostgREST makes the
-- headers available as request.headers. With no actor, actor_label says what
-- did it: 'hkha-sync' (a fixture update that stamps last_hkha_sync), 'eddy'
-- (the Worker with nobody signed in, e.g. a scheduled job) or 'sql' (not
-- through the API: the Table Editor, a migration).
--
-- What is kept (owner, 6 Oct 2026): old and new values for non-personal
-- fields (teams, Active, Opt-In Only, kit colours, fixture times...), only
-- the NAMES of personal and billing fields, as before. The value columns are
-- an allowlist, so a column added later is logged by name until it is listed.
--
-- When: the triggers are deferred to commit, so they see the flag an
-- officer's function sets after its own writes, and skip that transaction.
--
-- How long: two seasons (owner, 6 Oct 2026). prune_history() runs with the
-- nightly retention job.

alter table public.activity_log
  add column changes jsonb,
  add column actor_label text;

comment on column public.activity_log.changes is
  '{field: [old, new]} for the non-personal fields a row trigger saw change; null for rows written by functions';
comment on column public.activity_log.actor_label is
  'Who acted when there is no person: hkha-sync, eddy (the Worker, nobody signed in) or sql';

-- History is read per person and per match: coach-set answers are stored on
-- the match, with the player in changes.person.
create index activity_log_person_answers_idx on public.activity_log ((changes ->> 'person'))
  where action = 'row-availability';

-- The signed-in person behind this transaction, from the request header; null
-- when there is none or it isn't a person.
create function public.audit_actor() returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  v text := nullif(current_setting('request.headers', true), '')::json ->> 'x-eddy-actor';
begin
  if v is null or v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return (select p.id from public.people p where p.id = v::uuid);
end;
$$;

-- The columns whose values are kept, per table. Anything else that changed
-- is logged by name only; HOUSEKEEPING is not logged at all.
create function public.audit_value_columns(p_table text) returns text[]
language sql immutable
set search_path = ''
as $$
  select case p_table
    when 'people' then array[
      'status', 'applicant_stage', 'applicant_type', 'member_type', 'category_type', 'sports_type',
      'active', 'player_coach', 'registered_team', 'selected_team_sos', 'selected_team_eos', 'previous_eos',
      'playing_position', 'playing_level', 'playing_ability', 'opt_in_only', 'is_visiting_player',
      'is_suspended', 'matches_to_serve', 'qualified_coach', 'qualified_umpire', 'hkid_hidden']
    when 'matches' then array[
      'fixture_id', 'match_date', 'division', 'home_team', 'away_team', 'home_score', 'away_score', 'venue',
      'home_kit', 'away_kit', 'ump_1', 'ump_2', 'match_status', 'lock_hkha_sync', 'auto_select_enabled']
    when 'offices' then array['role', 'person_id', 'designation', 'status', 'office_email']
    when 'availability_exceptions' then array['status']
    else '{}'::text[]
  end
$$;

create function public.audit_housekeeping_columns() returns text[]
language sql immutable
set search_path = ''
as $$
  select array[
    'id', 'api_id', 'airtable_id', 'created_at', 'updated_at', 'last_hkha_sync', 'match_key',
    'stage_updated_at', 'profile_updated_at', 'volunteering_updated_at', 'last_seen_at',
    'section_rank', 'rank_updated_at', 'inactive_since',
    'training_comments_draft', 'sports_background_draft', 'updated_by_id', 'ordinal']
$$;

-- One logged change: (fields that changed, {field: [old, new]} for value
-- columns). Both empty when nothing that matters changed.
create function public.audit_diff(p_table text, p_old jsonb, p_new jsonb, out fields text[], out changes jsonb)
language plpgsql immutable
set search_path = ''
as $$
declare
  k text;
  skip text[] := public.audit_housekeeping_columns();
  keep text[] := public.audit_value_columns(p_table);
begin
  fields := '{}';
  changes := '{}'::jsonb;
  for k in
    select key from jsonb_object_keys(coalesce(p_old, '{}'::jsonb) || coalesce(p_new, '{}'::jsonb)) as key order by key
  loop
    continue when k = any (skip);
    continue when (p_old -> k) is not distinct from (p_new -> k);
    fields := fields || k;
    if k = any (keep) then
      changes := changes || jsonb_build_object(k, jsonb_build_array(p_old -> k, p_new -> k));
    end if;
  end loop;
end;
$$;

-- Security definer: the writes arrive as service_role, and the log and the
-- helpers above are not that role's to call.
create function public.audit_row() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_actor uuid;
  v_label text;
  v_fields text[];
  v_changes jsonb;
  v_action text;
  v_entity text;
  v_entity_id uuid;
begin
  -- An officer's function already wrote this transaction's log.
  if current_setting('eddy.audit_written', true) = 'on' then
    return null;
  end if;

  v_actor := public.audit_actor();
  if v_actor is null then
    v_label := case
      when nullif(current_setting('request.headers', true), '') is null then 'sql'
      when tg_table_name = 'matches' and (v_old ->> 'last_hkha_sync') is distinct from (v_new ->> 'last_hkha_sync') then 'hkha-sync'
      else 'eddy'
    end;
  end if;

  select d.fields, d.changes into v_fields, v_changes from public.audit_diff(tg_table_name, v_old, v_new) d;

  case tg_table_name
    when 'people' then
      -- Removing someone's personal data logs itself (remove_personal_data).
      if (v_old ->> 'personal_data_removed_at') is distinct from (v_new ->> 'personal_data_removed_at') then
        return null;
      end if;
      v_action := 'row-update';
      v_entity := 'people';
      v_entity_id := (v_row ->> 'id')::uuid;

    when 'matches' then
      v_action := 'row-' || lower(tg_op);
      v_entity := 'matches';
      v_entity_id := (v_row ->> 'id')::uuid;
      -- A new or removed fixture: what it is, not every column.
      if tg_op <> 'UPDATE' then
        v_fields := '{}';
        v_changes := jsonb_build_object(
          'match_date', v_row -> 'match_date', 'home_team', v_row -> 'home_team',
          'away_team', v_row -> 'away_team', 'venue', v_row -> 'venue');
      end if;

    when 'team_people' then
      -- Reordering a list isn't a change.
      if tg_op = 'UPDATE' then
        return null;
      end if;
      v_action := 'row-team-role';
      v_entity := 'people';
      v_entity_id := (v_row ->> 'person_id')::uuid;
      v_fields := array[v_row ->> 'role'];
      v_changes := jsonb_build_object(
        'team', (select t.team_name from public.teams t where t.id = (v_row ->> 'team_id')::uuid),
        'role', v_row ->> 'role',
        'change', case tg_op when 'INSERT' then 'added' else 'removed' end);

    when 'offices' then
      v_action := 'row-office-' || lower(tg_op);
      v_entity := 'people';
      v_entity_id := (v_row ->> 'person_id')::uuid;
      if tg_op <> 'UPDATE' then
        v_fields := array[v_row ->> 'role'];
        v_changes := jsonb_build_object('role', v_row -> 'role', 'status', v_row -> 'status');
      end if;

    when 'availability_exceptions' then
      -- Only an answer someone gives FOR the player (a coach); players' own
      -- answers would swamp the log, and their current answer shows anyway.
      if v_actor is null or v_actor = (v_row ->> 'person_id')::uuid then
        return null;
      end if;
      v_action := 'row-availability';
      v_entity := 'matches';
      v_entity_id := (v_row ->> 'match_id')::uuid;
      -- No row means Available (opt-out), so a delete is an Available answer.
      v_changes := jsonb_build_object(
        'person', v_row ->> 'person_id',
        'status', jsonb_build_array(
          coalesce(v_old ->> 'status', 'Available'),
          case when tg_op = 'DELETE' then 'Available' else v_new ->> 'status' end));
      if (v_changes #>> '{status,0}') = (v_changes #>> '{status,1}') and 'player_notes' <> all (v_fields) then
        return null;
      end if;
      v_fields := array_remove(array['status', case when 'player_notes' = any (v_fields) then 'player_notes' end], null);
  end case;

  if tg_op = 'UPDATE' and cardinality(v_fields) = 0 then
    return null;
  end if;

  insert into public.activity_log (actor_person_id, actor_label, action, entity, entity_id, fields, changes)
  values (v_actor, v_label, v_action, v_entity, v_entity_id, v_fields, v_changes);
  return null;
end;
$$;

create constraint trigger people_audit after update on public.people
  deferrable initially deferred for each row execute function public.audit_row();
create constraint trigger matches_audit after insert or update or delete on public.matches
  deferrable initially deferred for each row execute function public.audit_row();
create constraint trigger team_people_audit after insert or delete on public.team_people
  deferrable initially deferred for each row execute function public.audit_row();
create constraint trigger offices_audit after insert or update or delete on public.offices
  deferrable initially deferred for each row execute function public.audit_row();
create constraint trigger availability_exceptions_audit after insert or update or delete on public.availability_exceptions
  deferrable initially deferred for each row execute function public.audit_row();

-- set_team_people now changes only what differs, so replacing a list (a
-- coach's priority players, the social secretaries) logs the real
-- additions and removals rather than everyone out and back in.
create or replace function public.set_team_people(p_team text, p_role text, p_people text[]) returns void
language plpgsql
set search_path = ''
as $$
declare
  t uuid;
  v_want uuid[];
begin
  select id into t from public.teams where api_id = p_team;
  if t is null then
    raise exception 'No team %', p_team using errcode = 'P0002';
  end if;
  v_want := array(select public.person_uuid(x) from unnest(p_people) as x);
  delete from public.team_people
  where team_id = t and role = p_role and person_id <> all (v_want);
  insert into public.team_people (team_id, person_id, role, ordinal)
  select t, x.pid, p_role, x.ord
  from unnest(v_want) with ordinality as x(pid, ord)
  on conflict (team_id, role, person_id) do update set ordinal = excluded.ordinal
  where team_people.ordinal is distinct from excluded.ordinal;
end;
$$;

-- Two seasons of history (owner, 6 Oct 2026): everything before the start of
-- last season goes. Squad changes are history too. Returns rows removed.
create function public.prune_history() returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_cutoff timestamptz := make_date(split_part(public.current_season(), '-', 1)::int - 1, 7, 1)::timestamp
                          at time zone 'Asia/Hong_Kong';
  v_log integer;
  v_squads integer;
begin
  delete from public.activity_log where occurred_at < v_cutoff;
  get diagnostics v_log = row_count;
  delete from public.match_selection_changes where occurred_at < v_cutoff;
  get diagnostics v_squads = row_count;
  return v_log + v_squads;
end;
$$;

revoke all on function public.audit_actor(), public.audit_value_columns(text), public.audit_housekeeping_columns(),
  public.audit_diff(text, jsonb, jsonb), public.audit_row(), public.prune_history() from public, anon, authenticated;
grant execute on function public.prune_history() to service_role;
