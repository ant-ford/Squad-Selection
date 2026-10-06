-- The Membership Officer and the Chairman are one holder at a time (owner,
-- 6 Oct 2026). Section Captains, sponsors and the other offices stay
-- multi-holder.
--
-- Rule (refuse, not auto-retire): adding a holder to one of these offices
-- while someone holds it is refused with {status: 'conflict', code:
-- 'ONE_HOLDER'} unless `replaces` names the current holder's row, which is
-- then retired in the same transaction (the handover). Reactivating a
-- retired row while another is Active is refused the same way. Nobody is
-- retired without the screen saying who.
--
-- Backstop: a partial unique index, one Active row per role for these two
-- roles. Created only when no role already has two Active rows (preview had
-- one each on 6 Oct 2026); otherwise a warning, and the function's check
-- alone holds the rule until the data is fixed.

create or replace function public.admin_save_office(p jsonb, p_actor text) returns jsonb
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
  one_holder constant text[] := array['membership_officer', 'section_chair'];
  v_current text;
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
      if p ->> 'status' = 'Active' and o.role = any (one_holder)
         and exists (select 1 from public.offices x where x.role = o.role and x.status = 'Active' and x.id <> o.id) then
        return jsonb_build_object('status', 'conflict', 'code', 'ONE_HOLDER');
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
    if p ->> 'role' = any (one_holder) then
      -- Lock the office's rows so two handovers can't both pass this check.
      perform 1 from public.offices x where x.role = p ->> 'role' for update;
      select x.api_id into v_current from public.offices x where x.role = p ->> 'role' and x.status = 'Active';
      if v_current is not null and (p ->> 'replaces') is distinct from v_current then
        return jsonb_build_object('status', 'conflict', 'code', 'ONE_HOLDER');
      end if;
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

do $$
begin
  if exists (select 1 from public.offices
             where status = 'Active' and role in ('membership_officer', 'section_chair')
             group by role having count(*) > 1) then
    raise warning 'offices_one_holder_idx not created: a Membership Officer or Chairman office has two Active holders';
  else
    create unique index offices_one_holder_idx on public.offices (role)
      where status = 'Active' and role in ('membership_officer', 'section_chair');
  end if;
end $$;
