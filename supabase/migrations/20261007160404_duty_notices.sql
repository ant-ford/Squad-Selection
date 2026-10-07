-- Umpire duties for the umpire (6 Oct 2026 review, item D1): their
-- confirmed duties in their own calendar feed, a "Your duty" line on the
-- player page, and a My Tasks line when a duty they hold moves or is
-- called off. Cancelled duties are kept for exactly this (see
-- 20261006200000_umpiring).
--
-- A duty's key holds its date, so a game moved to ANOTHER DAY arrives as a
-- new duty and the old one is marked cancelled by the next sync; a new
-- kick-off time on the same day changes the duty in place. Either way the
-- umpire's own duty shows the change, and a cancelled one names the new
-- date when the same slot exists again.

alter table public.umpire_duties
  add column previous_match_date timestamptz,
  add column changed_at timestamptz;

create function public.umpire_duties_keep_previous() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.match_date is distinct from old.match_date then
    new.previous_match_date := old.match_date;
    new.changed_at := now();
  end if;
  if new.status is distinct from old.status then
    new.changed_at := now();
  end if;
  return new;
end;
$$;
create trigger umpire_duties_keep_previous before update of match_date, status on public.umpire_duties
  for each row execute function public.umpire_duties_keep_previous();

-- When the umpire last looked at a change to this duty (the umpiring board).
alter table public.umpire_assignments add column seen_change_at timestamptz;

-- A person's confirmed duties from two weeks ago on, oldest first, with
-- whether a change since they took it (or last looked) is still unseen and,
-- for one called off, the slot's new date if HKHA has listed it: a duty for
-- the same teams and slot first listed around the time it was called off.
create function public.my_duties(p_person text)
returns table (
  assignment_id uuid, duty_id uuid, match_date timestamptz, time_tbc boolean, venue text,
  home_team text, away_team text, slot smallint, duty_team text, status text,
  previous_match_date timestamptz, changed_at timestamptz, unseen_change boolean, moved_to timestamptz)
language sql stable
set search_path = ''
as $$
  select a.id, d.id, d.match_date, d.time_tbc, d.venue, d.home_team, d.away_team, d.slot, d.duty_team, d.status,
         d.previous_match_date, d.changed_at,
         d.changed_at is not null and d.changed_at > coalesce(a.seen_change_at, a.confirmed_at, a.created_at),
         case when d.status <> 'scheduled' then (
           select min(n.match_date) from public.umpire_duties n
           where n.id <> d.id and n.status <> 'cancelled' and n.home_team = d.home_team and n.away_team = d.away_team
             and n.slot = d.slot and n.match_date >= now()
             -- The new date arrives as a duty created around the call-off,
             -- not the teams' next regular meeting, listed all season.
             and n.created_at > d.created_at + interval '1 hour'
             and n.created_at >= d.changed_at - interval '7 days')
         end
  from public.umpire_assignments a
  join public.umpire_duties d on d.id = a.duty_id
  join public.people p on p.id = a.person_id
  where p.api_id = p_person and a.status = 'confirmed' and d.match_date >= now() - interval '14 days'
  order by d.match_date, d.slot
$$;

-- They've seen the change: the My Tasks line goes. True when it was theirs.
create function public.ack_duty_change(p_assignment uuid, p_person text) returns boolean
language sql
set search_path = ''
as $$
  update public.umpire_assignments a set seen_change_at = now()
  from public.people p
  where a.id = p_assignment and p.id = a.person_id and p.api_id = p_person
  returning true
$$;

revoke all on function public.my_duties(text), public.ack_duty_change(uuid, text) from public, anon, authenticated;
grant execute on function public.my_duties(text), public.ack_duty_change(uuid, text) to service_role;
