-- Manual suspensions, set by the Men's Convenor (owner, 6 Oct 2026).
--
-- Red cards and Disciplinary Committee decisions are not turned into
-- suspensions automatically (worker/src/suspension.ts says why), so the
-- Convenor records them here: a number of matches, or until cleared,
-- counted from a start date against one serving team. The Worker counts
-- what has been served (suspension.ts manualSuspensionProgress): Played
-- league and cup fixtures of the serving team whose Hong Kong date is
-- strictly after from_date. Friendlies never count.
--
-- Every write is one function that also writes its activity_log row (field
-- names only), so the change and its record land together or not at all.
--
-- people.is_suspended / matches_to_serve were the hand-set Airtable flags.
-- Eligibility still reads them, so nothing that set them is lost, but
-- nothing in Eddy writes them any more: flags set today move into this
-- table below (counting from today) and are zeroed. A flag on someone with
-- no registered team stays where it is (such a player cannot be selected
-- anyway) and is cleared when the Convenor records a suspension for them.

create table public.suspensions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  -- null: until cleared.
  matches smallint check (matches is null or matches between 1 and 52),
  from_date date not null,
  serving_team text not null references public.teams (team_name) on update cascade on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 1 and 280),
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid references public.people (id) on delete set null,
  clear_reason text check (clear_reason is null or char_length(clear_reason) <= 280)
);
create index suspensions_person_idx on public.suspensions (person_id);
create index suspensions_open_idx on public.suspensions (person_id) where cleared_at is null;
create index suspensions_serving_team_idx on public.suspensions (serving_team);
create index suspensions_created_by_idx on public.suspensions (created_by);
create index suspensions_cleared_by_idx on public.suspensions (cleared_by);
create trigger suspensions_updated_at before update on public.suspensions
  for each row execute function public.set_updated_at();

alter table public.suspensions enable row level security;
revoke all on public.suspensions from public, anon, authenticated;
grant select, insert, update, delete on public.suspensions to service_role;

-- What the Worker reads: links as api_ids, timestamps in Airtable's form.
create view public.api_suspensions with (security_invoker = true) as
  select s.id::text as id, p.api_id as player, s.matches, s.from_date, s.serving_team, s.reason,
         public.airtable_ts(s.created_at) as created_at, cb.api_id as created_by,
         public.airtable_ts(s.cleared_at) as cleared_at, xb.api_id as cleared_by, s.clear_reason
  from public.suspensions s
  join public.people p on p.id = s.person_id
  left join public.people cb on cb.id = s.created_by
  left join public.people xb on xb.id = s.cleared_by;
revoke all on public.api_suspensions from public, anon, authenticated;
grant select on public.api_suspensions to service_role;

-- ── The hand-set flags ─────────────────────────────────────────────────
-- Counting from today, served by the registered team. None are set on
-- preview (6 Oct 2026).
insert into public.suspensions (person_id, matches, from_date, serving_team, reason)
select p.id,
       case when coalesce(p.matches_to_serve, 0) > 0 then least(p.matches_to_serve, 52) end,
       (now() at time zone 'Asia/Hong_Kong')::date,
       p.registered_team,
       'Carried over from Is Suspended / Matches To Serve'
from public.people p
where (p.is_suspended or coalesce(p.matches_to_serve, 0) > 0)
  and p.registered_team in (select team_name from public.teams);

update public.people
set is_suspended = false, matches_to_serve = null
where (is_suspended or coalesce(matches_to_serve, 0) > 0)
  and registered_team in (select team_name from public.teams);

-- ── Writes ──────────────────────────────────────────────────────────────

-- Records a suspension, or changes an open one.
-- p = {"player": api_id, "matches": 1-52 | null, "fromDate": "YYYY-MM-DD",
--      "servingTeam": team name (default: the registered team), "reason": text}
-- or {"id": uuid, and any of "matches", "fromDate", "servingTeam", "reason"}.
-- p_actor is the Convenor's api_id. Returns the suspension's id.
create function public.admin_save_suspension(p jsonb, p_actor text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := case when p_actor is null then null else public.person_uuid(p_actor) end;
  v_id uuid;
  v_person uuid;
  v_team text;
  v_action text;
  v_fields text[];
begin
  if p ? 'id' then
    update public.suspensions set
      matches = case when p ? 'matches' then (p ->> 'matches')::smallint else matches end,
      from_date = case when p ? 'fromDate' then (p ->> 'fromDate')::date else from_date end,
      serving_team = case when p ? 'servingTeam' then nullif(btrim(p ->> 'servingTeam'), '') else serving_team end,
      reason = case when p ? 'reason' then btrim(p ->> 'reason') else reason end
    where id = (p ->> 'id')::uuid and cleared_at is null
    returning id, person_id into v_id, v_person;
    if v_id is null then
      raise exception 'No open suspension %', p ->> 'id' using errcode = 'P0002';
    end if;
    v_action := 'admin-suspension-edit';
    select coalesce(array_agg(f), '{}') into v_fields
    from unnest(array['matches', 'from_date', 'serving_team', 'reason']) f
    where p ? (case f when 'from_date' then 'fromDate' when 'serving_team' then 'servingTeam' else f end);
  else
    v_person := public.person_uuid(p ->> 'player');
    v_team := coalesce(nullif(btrim(p ->> 'servingTeam'), ''),
                       (select registered_team from public.people where id = v_person));
    if v_team is null then
      raise exception 'No serving team' using errcode = '22023';
    end if;
    insert into public.suspensions (person_id, matches, from_date, serving_team, reason, created_by)
    values (v_person, (p ->> 'matches')::smallint, (p ->> 'fromDate')::date, v_team,
            btrim(p ->> 'reason'), v_actor)
    returning id into v_id;
    v_action := 'admin-suspension-set';
    v_fields := array['suspensions'];
    -- A hand-set flag left over from Airtable is replaced by this record.
    update public.people set is_suspended = false, matches_to_serve = null
    where id = v_person and (is_suspended or coalesce(matches_to_serve, 0) > 0);
    if found then
      v_fields := v_fields || array['is_suspended', 'matches_to_serve'];
    end if;
  end if;

  -- Field names only, as everywhere in the activity log.
  insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
  values (v_actor, v_action, 'people', v_person, v_fields);
  -- History triggers (Track C) skip a transaction that logged itself.
  perform set_config('eddy.audit_written', 'on', true);
  return v_id::text;
end;
$$;

-- Ends an open suspension now (served early, overturned, entered by mistake).
create function public.admin_clear_suspension(p_id uuid, p_actor text, p_reason text default null) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := case when p_actor is null then null else public.person_uuid(p_actor) end;
  v_person uuid;
begin
  update public.suspensions
  set cleared_at = now(), cleared_by = v_actor, clear_reason = nullif(btrim(p_reason), '')
  where id = p_id and cleared_at is null
  returning person_id into v_person;
  if v_person is null then
    raise exception 'No open suspension %', p_id using errcode = 'P0002';
  end if;
  insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
  values (v_actor, 'admin-suspension-clear', 'people', v_person, array['suspensions']);
  perform set_config('eddy.audit_written', 'on', true);
end;
$$;

revoke all on function public.admin_save_suspension(jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_clear_suspension(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_save_suspension(jsonb, text) to service_role;
grant execute on function public.admin_clear_suspension(uuid, text, text) to service_role;

-- ── Removing personal data ──────────────────────────────────────────────
-- A suspension's reason is about the person: when retention or "Delete my
-- profile" removes their personal data (people.personal_data_removed_at is
-- set), their suspensions go too, as their is_suspended flag already does.
-- A trigger rather than a change to erase_personal_data, which is due to
-- be rewritten when the archive schema goes.
create function public.suspensions_forget_person() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.suspensions where person_id = new.id;
  return new;
end;
$$;
revoke all on function public.suspensions_forget_person() from public, anon, authenticated;

create trigger people_forget_suspensions
  after update of personal_data_removed_at on public.people
  for each row
  when (old.personal_data_removed_at is null and new.personal_data_removed_at is not null)
  execute function public.suspensions_forget_person();
