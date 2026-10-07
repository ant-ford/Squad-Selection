-- Fixture changes (6 Oct 2026 review, item D6; owner: shown for 7 days).
--
-- hkha-sync changes a fixture's time, venue and status in place, and the app
-- listed only Scheduled matches, so a postponed game simply vanished and a
-- moved one changed without a word. Each fixture now keeps what it was
-- before its last change:
--
--   previous_match_date, previous_venue, previous_status  the value before
--       the change, kept per field (a later change of another field leaves
--       it), never set when a blank is first filled in;
--   changed_at  when any of the three last changed.
--
-- Status counts only when a game is called off or brought back
-- (Rescheduled / Cancelled / Postponed, either way): Scheduled to Played is
-- not a change anyone needs telling about. HKHA keeps a postponed game as
-- its own row marked Rescheduled and adds the new date as a new row.
--
-- The cards show "Moved from …", "Venue changed" or "Postponed" while
-- changed_at is less than 7 days old (shared/fixtureChange.ts).

alter table public.matches
  add column previous_match_date timestamptz,
  add column previous_venue text,
  add column previous_status text,
  add column changed_at timestamptz;

create index matches_changed_at_idx on public.matches (changed_at) where changed_at is not null;

create function public.matches_keep_previous() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_off text[] := array['Rescheduled', 'Cancelled', 'Postponed'];
begin
  if new.match_date is distinct from old.match_date and old.match_date is not null then
    new.previous_match_date := old.match_date;
    new.changed_at := now();
  end if;
  if new.venue is distinct from old.venue and coalesce(old.venue, '') <> '' then
    new.previous_venue := old.venue;
    new.changed_at := now();
  end if;
  if new.match_status is distinct from old.match_status
     and (new.match_status = any (v_off) or old.match_status = any (v_off)) then
    new.previous_status := old.match_status;
    new.changed_at := now();
  end if;
  return new;
end;
$$;

create trigger matches_keep_previous before update of match_date, venue, match_status on public.matches
  for each row execute function public.matches_keep_previous();

-- The change history (20261007160004) logs the change itself, not these.
create or replace function public.audit_housekeeping_columns() returns text[]
language sql immutable
set search_path = ''
as $$
  select array[
    'id', 'api_id', 'airtable_id', 'created_at', 'updated_at', 'last_hkha_sync', 'match_key',
    'stage_updated_at', 'profile_updated_at', 'volunteering_updated_at', 'last_seen_at',
    'section_rank', 'rank_updated_at', 'inactive_since',
    'training_comments_draft', 'sports_background_draft', 'updated_by_id', 'ordinal',
    'previous_match_date', 'previous_venue', 'previous_status', 'changed_at']
$$;

-- api_matches gains the four columns at the end; nothing else changes.
create or replace view public.api_matches with (security_invoker = true) as
  select b.api_id as id, public.airtable_ts(m.match_date) as match_date, m.season, m.division, m.competition_type,
         m.home_team, m.home_score, m.away_team, m.away_score, m.match_status, m.venue, m.fixture_id,
         coalesce(array(select p.api_id from public.match_selections ms join public.people p on p.id = ms.person_id
                        where ms.match_id = m.id and ms.side = 'home' order by ms.ordinal), '{}') as selected_players_home,
         coalesce(array(select p.api_id from public.match_selections ms join public.people p on p.id = ms.person_id
                        where ms.match_id = m.id and ms.side = 'away' order by ms.ordinal), '{}') as selected_players_away,
         m.auto_select_enabled, m.home_kit, m.away_kit, m.ump_1, m.ump_2,
         coalesce((select v.version from public.match_selection_versions v
                   where v.match_id = m.id and v.side = 'home'), 0) as selection_version_home,
         coalesce((select v.version from public.match_selection_versions v
                   where v.match_id = m.id and v.side = 'away'), 0) as selection_version_away,
         public.airtable_ts(b.previous_match_date) as previous_match_date, b.previous_venue, b.previous_status,
         public.airtable_ts(b.changed_at) as changed_at
  from public.matches_v m
  join public.matches b on b.id = m.id;
