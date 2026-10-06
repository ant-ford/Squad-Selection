-- Section Captains' screens for offices and teams (worker/src/admin/club.ts;
-- owner, 6 Oct 2026: Section Captains manage every office, sponsors
-- included).
--
-- Each write is one function: the change and its activity_log rows in one
-- transaction (column NAMES only, never values), and the transaction-local
-- flag eddy.audit_written set, as admin_update_person does. A rule that says
-- no answers {status: 'conflict', code} instead of raising.

-- Someone who holds an office but isn't in People yet (a new sponsor, a
-- chairman from outside the section). Not Active: an office lets them sign
-- in on its own (auth.ts). Answers {status: 'ok', id} or EMAIL_TAKEN.
create function public.admin_create_person(p jsonb, p_actor text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := case when p_actor is null then null else public.person_uuid(p_actor) end;
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_id uuid;
  v_api text;
begin
  if coalesce(btrim(p ->> 'surname'), '') = '' or v_email = '' then
    raise exception 'Surname and email are needed' using errcode = '22023';
  end if;
  if exists (select 1 from public.people where lower(email) = v_email) then
    return jsonb_build_object('status', 'conflict', 'code', 'EMAIL_TAKEN');
  end if;
  insert into public.people (preferred_name, given_names, surname, email, active)
  values (nullif(btrim(p ->> 'preferredName'), ''), nullif(btrim(p ->> 'givenNames'), ''),
          btrim(p ->> 'surname'), v_email, false)
  returning id, api_id into v_id, v_api;
  insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
  values (v_actor, 'admin-person-create', 'people', v_id,
          array_remove(array[
            case when nullif(btrim(p ->> 'preferredName'), '') is not null then 'preferred_name' end,
            case when nullif(btrim(p ->> 'givenNames'), '') is not null then 'given_names' end,
            'surname', 'email'], null));
  perform set_config('eddy.audit_written', 'on', true);
  return jsonb_build_object('status', 'ok', 'id', v_api);
end;
$$;

-- Adds an office holder, or changes one office row.
--   New: {role, person, designation?, officeEmail?, replaces?}. `replaces`
--   is the api id of the Active row of the same role being handed over: it
--   is retired in the same transaction. ALREADY_HOLDS if the person already
--   has an Active row of that role.
--   Change: {id, designation?, officeEmail?, status?}. LAST_SECTION_CAPTAIN
--   if it would retire the last Active Section Captain; ALREADY_HOLDS if it
--   would reactivate a row whose holder has another Active one.
-- Social secretaries are managed in Events, not here.
-- Logs the office row (entity 'offices') and each holder concerned (entity
-- 'people', fields '<role>' or '<role>:retired' / '<role>:active').
create function public.admin_save_office(p jsonb, p_actor text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  roles constant text[] := array['section_captain', 'membership_officer', 'section_chair', 'hockey_convenor',
                                 'kit_convenor', 'assistant_director', 'umpire_coordinator', 'sponsor'];
  v_actor uuid := case when p_actor is null then null else public.person_uuid(p_actor) end;
  o public.offices%rowtype;
  n public.offices%rowtype;
  v_fields text[];
  v_person uuid;
begin
  if p ? 'id' then
    select * into o from public.offices where api_id = p ->> 'id' for update;
    if not found or not (o.role = any (roles)) then
      raise exception 'No office %', p ->> 'id' using errcode = 'P0002';
    end if;
    if p ? 'status' and (p ->> 'status') is distinct from o.status then
      if p ->> 'status' = 'Retired' and o.role = 'section_captain'
         and not exists (select 1 from public.offices x
                         where x.role = 'section_captain' and x.status = 'Active' and x.id <> o.id) then
        return jsonb_build_object('status', 'conflict', 'code', 'LAST_SECTION_CAPTAIN');
      end if;
      if p ->> 'status' = 'Active'
         and exists (select 1 from public.offices x
                     where x.role = o.role and x.person_id = o.person_id and x.status = 'Active' and x.id <> o.id) then
        return jsonb_build_object('status', 'conflict', 'code', 'ALREADY_HOLDS');
      end if;
    end if;
    update public.offices set
      designation = case when p ? 'designation' then nullif(btrim(p ->> 'designation'), '') else designation end,
      office_email = case when p ? 'officeEmail' then nullif(lower(btrim(p ->> 'officeEmail')), '') else office_email end,
      status = case when p ? 'status' then p ->> 'status' else status end
    where id = o.id
    returning * into n;
    select coalesce(array_agg(k order by k), '{}') into v_fields
    from unnest(array['designation', 'office_email', 'status']) k
    where to_jsonb(o) -> k is distinct from to_jsonb(n) -> k;
    if cardinality(v_fields) > 0 then
      insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
      values (v_actor, 'admin-office', 'offices', n.id, v_fields),
             (v_actor, 'admin-office', 'people', n.person_id,
              array[n.role || case when 'status' = any (v_fields) then ':' || lower(n.status) else '' end]);
      perform set_config('eddy.audit_written', 'on', true);
    end if;
  else
    if not (coalesce(p ->> 'role', '') = any (roles)) then
      raise exception 'Unknown office %', p ->> 'role' using errcode = '22023';
    end if;
    v_person := public.person_uuid(p ->> 'person');
    if exists (select 1 from public.offices x
               where x.role = p ->> 'role' and x.person_id = v_person and x.status = 'Active') then
      return jsonb_build_object('status', 'conflict', 'code', 'ALREADY_HOLDS');
    end if;
    if p ? 'replaces' then
      update public.offices set status = 'Retired'
      where api_id = p ->> 'replaces' and role = p ->> 'role' and status = 'Active'
      returning * into o;
      if not found then
        raise exception 'No Active % office %', p ->> 'role', p ->> 'replaces' using errcode = 'P0002';
      end if;
      insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
      values (v_actor, 'admin-office', 'offices', o.id, array['status']),
             (v_actor, 'admin-office', 'people', o.person_id, array[o.role || ':retired']);
    end if;
    insert into public.offices (role, person_id, designation, office_email, status)
    values (p ->> 'role', v_person, nullif(btrim(p ->> 'designation'), ''),
            nullif(lower(btrim(p ->> 'officeEmail')), ''), 'Active')
    returning * into n;
    insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
    values (v_actor, 'admin-office', 'offices', n.id,
            array['role', 'person_id'] || case when n.designation is null then '{}'::text[] else array['designation'] end
                                       || case when n.office_email is null then '{}'::text[] else array['office_email'] end),
           (v_actor, 'admin-office', 'people', n.person_id, array[n.role]);
    perform set_config('eddy.audit_written', 'on', true);
  end if;
  return jsonb_build_object('status', 'ok', 'id', n.api_id);
end;
$$;

-- A team's coaches and captains (whole lists, in order) and target squad
-- size. The Teams Section Captain links are not changed here: they grant
-- coach rights on every team (auth.ts). Logs the team (entity 'teams') and
-- each person added or removed (entity 'people', '<role>:<team>').
create function public.admin_save_team(p_team text, p_actor text, p jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := case when p_actor is null then null else public.person_uuid(p_actor) end;
  t record;
  r text;
  v_key text;
  v_size integer;
  v_before uuid[];
  v_after uuid[];
  v_fields text[] := '{}';
begin
  select id, team_name, target_squad_size into t from public.teams where api_id = p_team for update;
  if not found then
    raise exception 'No team %', p_team using errcode = 'P0002';
  end if;
  if p ? 'targetSquadSize' then
    v_size := (p ->> 'targetSquadSize')::integer;
    if v_size is null or v_size not between 1 and 40 then
      raise exception 'Target squad size must be 1 to 40' using errcode = '22023';
    end if;
    if v_size is distinct from t.target_squad_size then
      update public.teams set target_squad_size = v_size where id = t.id;
      v_fields := v_fields || 'target_squad_size'::text;
    end if;
  end if;
  foreach r in array array['coach', 'team_captain'] loop
    v_key := case r when 'coach' then 'coaches' else 'captains' end;
    continue when not (p ? v_key);
    if jsonb_typeof(p -> v_key) <> 'array' then
      raise exception '% must be a list', v_key using errcode = '22023';
    end if;
    select coalesce(array_agg(person_id), '{}') into v_before from public.team_people where team_id = t.id and role = r;
    perform public.set_team_people(p_team, r, array(select jsonb_array_elements_text(p -> v_key)));
    select coalesce(array_agg(person_id), '{}') into v_after from public.team_people where team_id = t.id and role = r;
    if not (v_before @> v_after and v_after @> v_before) then
      v_fields := v_fields || r;
      insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
      select v_actor, 'admin-team-role', 'people', x.pid, array[r || ':' || t.team_name]
      from ((select unnest(v_after) except select unnest(v_before))
            union (select unnest(v_before) except select unnest(v_after))) as x(pid);
    end if;
  end loop;
  if cardinality(v_fields) > 0 then
    insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
    values (v_actor, 'admin-team', 'teams', t.id, v_fields);
    perform set_config('eddy.audit_written', 'on', true);
  end if;
  return jsonb_build_object('status', 'ok', 'changed', to_jsonb(v_fields));
end;
$$;

revoke all on function public.admin_create_person(jsonb, text), public.admin_save_office(jsonb, text),
  public.admin_save_team(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_create_person(jsonb, text), public.admin_save_office(jsonb, text),
  public.admin_save_team(text, text, jsonb) to service_role;
