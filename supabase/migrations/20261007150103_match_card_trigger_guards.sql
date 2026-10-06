-- Match card row triggers that run only when something they read changed
-- (Track C, 7 Oct 2026).
--
-- An "UPDATE OF col" trigger fires whenever col is in the SET list, even when
-- the value is the same. hkha-sync already patches only the columns that
-- differ (src/supabase/match_cards.py), so today this saves little. It guards
-- against any other writer (a script, a re-import, a future Worker screen)
-- that writes unchanged values:
--
--   - match_cards_auto_reregister runs a season's play-up count
--     (auto_reregister) for every card in the statement. It is split in two,
--     because a trigger that also fires on INSERT cannot test OLD in its
--     WHEN: inserts keep the old trigger name; updates get
--     match_cards_auto_reregister_update, which fires only when one of the
--     five columns it depends on really changed.
--   - match_cards_link_person only does anything when person_id is null and
--     there is a name (its function's own test), so the WHEN says so and the
--     People name lookup is skipped for every other row, on both events.
--   - match_cards_updated_at stamps updated_at only when the row really
--     changed, so a no-op write doesn't look like an edit (the cache_versions
--     triggers ignore updated_at either way).
--
-- The functions are unchanged, and so is what each trigger does when it
-- fires; public.importing() is still checked inside them.

drop trigger match_cards_auto_reregister on public.match_cards;
create trigger match_cards_auto_reregister
  after insert on public.match_cards
  for each row execute function public.match_cards_auto_reregister();
create trigger match_cards_auto_reregister_update
  after update of person_id, match_id, team, player_team, goalkeeper on public.match_cards
  for each row
  when (old.person_id is distinct from new.person_id
        or old.match_id is distinct from new.match_id
        or old.team is distinct from new.team
        or old.player_team is distinct from new.player_team
        or old.goalkeeper is distinct from new.goalkeeper)
  execute function public.match_cards_auto_reregister();

drop trigger match_cards_link_person on public.match_cards;
create trigger match_cards_link_person
  before insert or update of raw_player_name, person_id on public.match_cards
  for each row
  when (new.person_id is null and new.raw_player_name is not null)
  execute function public.match_cards_link_person();

-- A BEFORE trigger's WHEN can't name a generated column (api_id), so the
-- columns are listed: every stored column except api_id and updated_at
-- itself (a write that sets only updated_at keeps the value it set, as the
-- function would). A column added to match_cards later must be added here,
-- or a change to only that column won't move updated_at.
drop trigger match_cards_updated_at on public.match_cards;
create trigger match_cards_updated_at
  before update on public.match_cards
  for each row
  when ((old.id, old.airtable_id, old.match_id, old.person_id, old.raw_player_name, old.team, old.player_team,
         old.jersey_number, old.goals_scored, old.cards, old.captain, old.goalkeeper, old.vp, old.u21,
         old.fixture_id, old.created_at)
        is distinct from
        (new.id, new.airtable_id, new.match_id, new.person_id, new.raw_player_name, new.team, new.player_team,
         new.jersey_number, new.goals_scored, new.cards, new.captain, new.goalkeeper, new.vp, new.u21,
         new.fixture_id, new.created_at))
  execute function public.set_updated_at();
