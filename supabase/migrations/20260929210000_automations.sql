-- The Airtable automations Eddy still needs, done by the database so every
-- writer (the Worker, hkha-sync, a future screen) gets them. Each copies
-- what the Airtable automation did, as read from the data it produced.
-- (The review emails need the mailer, so they live in the Worker.)
--
-- They stand aside while the Airtable import runs (it sets eddy.importing =
-- 'on' for its session): the import must copy Airtable exactly, and
-- Airtable's own automations already did this work on that data.
create function public.importing() returns boolean
language sql stable
set search_path = ''
as $$ select coalesce(current_setting('eddy.importing', true), '') = 'on' $$;

-- 1. "Update Status when Applicant Accepted": an applicant moved to Accepted
--    or Temporary becomes a Member.
create function public.people_accept_status() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.importing() then
    return new;
  end if;
  if new.applicant_stage in ('Accepted', 'Temporary') and new.status = 'Applicant'
     and (tg_op = 'INSERT' or new.applicant_stage is distinct from old.applicant_stage) then
    new.status := 'Member';
  end if;
  return new;
end;
$$;
create trigger people_accept_status before insert or update of applicant_stage on public.people
  for each row execute function public.people_accept_status();

-- 2. "Link Match Cards to People": a card names the player as the HKHA card
--    prints it, which is the person's Registered Name (8,446 of the 8,457
--    links Airtable made match it, ignoring case). Linked only when exactly
--    one person has that name; otherwise left for a person to resolve.
create function public.match_cards_link_person() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  found uuid[];
begin
  if public.importing() then
    return new;
  end if;
  if new.person_id is null and new.raw_player_name is not null then
    select array_agg(id) into found
    from public.people
    where lower(trim(registered_name)) = lower(trim(new.raw_player_name));
    if cardinality(found) = 1 then
      new.person_id := found[1];
    end if;
  end if;
  return new;
end;
$$;
create trigger match_cards_link_person before insert or update of raw_player_name, person_id on public.match_cards
  for each row execute function public.match_cards_link_person();

-- 3. "Update Commitment Records": a member's yearly commitment periods, from
--    the join date to the commitment end date. Year N runs from the (N-1)th
--    anniversary of joining to the day before the Nth. A remainder of under
--    three months is folded into the last year rather than becoming a stub
--    year of its own, as the imported rows show Airtable did. A year whose
--    review has not started follows a changed end date; a year whose review
--    has started is never touched.
create function public.ensure_commitment_periods(p_person uuid) returns integer
language plpgsql
set search_path = ''
as $$
declare
  j date;
  ced date;
  n integer := 1;
  s date;
  e date;
  nxt date;
  changed integer := 0;
begin
  select join_date, commitment_end_date into j, ced from public.people where id = p_person;
  if j is null or ced is null or ced <= j then
    return 0;
  end if;
  loop
    s := (j + make_interval(years => n - 1))::date;
    exit when s >= ced or n > 30;
    nxt := (j + make_interval(years => n))::date;
    e := nxt - 1;
    if e >= ced or (nxt + interval '3 months')::date > ced then
      e := ced;
    end if;
    if not exists (select 1 from public.commitments where person_id = p_person and year_no = n) then
      insert into public.commitments (person_id, year_no, period_start, period_end, review_progress)
      values (p_person, n, s, e, 'Not Started');
      changed := changed + 1;
    else
      update public.commitments
         set period_start = s, period_end = e
       where person_id = p_person and year_no = n and review_progress = 'Not Started'
         and (period_start, period_end) is distinct from (s, e);
      if found then
        changed := changed + 1;
      end if;
    end if;
    exit when e >= ced;
    n := n + 1;
  end loop;
  return changed;
end;
$$;

create function public.people_commitment_periods() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.importing() then
    return null;
  end if;
  if new.join_date is not null and new.commitment_end_date is not null
     and (tg_op = 'INSERT' or new.join_date is distinct from old.join_date
          or new.commitment_end_date is distinct from old.commitment_end_date) then
    perform public.ensure_commitment_periods(new.id);
  end if;
  return null;
end;
$$;
create trigger people_commitment_periods after insert or update of join_date, commitment_end_date on public.people
  for each row execute function public.people_commitment_periods();

-- 4. "Update Commitments for # Matches & Teams Played", as a view that is
--    always current rather than a script every four days. For a period:
--    appearances (friendlies excluded, as everywhere in Eddy), the teams they
--    were for, the registered team's played fixtures, and the fixtures the
--    member said they could not make. The stored columns on commitments keep
--    what was recorded when a review was submitted.
create view public.commitment_attendance_v with (security_invoker = true) as
  select c.id as commitment_id, c.api_id,
         count(distinct mc.match_id) filter (where mc.id is not null) as matches_played,
         coalesce(array_agg(distinct mc.team) filter (where mc.team is not null), '{}') as teams_played,
         (select count(*) from public.matches_v tm
           where tm.match_status = 'Played' and tm.competition_type is distinct from 'FRIENDLY'
             and tm.match_date::date between c.period_start and c.period_end
             and p.registered_team in (tm.home_team, tm.away_team)) as matches_team_played,
         (select count(*) from public.availability_exceptions ae join public.matches am on am.id = ae.match_id
           where ae.person_id = c.person_id and ae.status = 'Unavailable'
             and am.match_date::date between c.period_start and c.period_end) as matches_not_available
  from public.commitments c
  join public.people p on p.id = c.person_id
  left join public.match_cards mc on mc.person_id = c.person_id
       and exists (select 1 from public.matches_v m where m.id = mc.match_id
                   and m.match_date::date between c.period_start and c.period_end
                   and m.competition_type is distinct from 'FRIENDLY')
  where c.period_start is not null and c.period_end is not null
  group by c.id, c.api_id, c.person_id, c.period_start, c.period_end, p.registered_team;

do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('revoke all on %s from anon, authenticated', r.rel);
    execute format('grant select on %s to service_role', r.rel);
  end loop;
  for r in
    select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;
end;
$$;
