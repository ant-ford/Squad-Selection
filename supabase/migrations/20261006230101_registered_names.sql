-- Registered Names set on the Hockey Convenor's registration screen
-- (worker/src/registration.ts; 6 Oct 2026).
--
-- A match card is linked to a person by its name as HKHA prints it, which is
-- the person's Registered Name (match_cards_link_person). That trigger runs
-- only when a card is written, so a card that arrived before its player had
-- a Registered Name stays unlinked, and his play-ups, card points and
-- suspensions are missed. Saving a name links this season's unlinked cards
-- that carry it, with the trigger's own rule: the same comparison (trimmed,
-- ignoring case) and only when exactly one person has that name.
--
-- Setting person_id fires match_cards_auto_reregister, so play-ups that
-- surface this way count towards an automatic re-registration as usual.
--
-- Returns how many cards were linked.
create function public.link_match_cards_by_name(p_name text) returns integer
language plpgsql
set search_path = ''
as $$
declare
  found uuid[];
  n integer;
begin
  if coalesce(trim(p_name), '') = '' then
    return 0;
  end if;
  select array_agg(id) into found
  from public.people
  where lower(trim(registered_name)) = lower(trim(p_name));
  if cardinality(found) is distinct from 1 then
    return 0;
  end if;
  update public.match_cards c
  set person_id = found[1]
  from public.matches m
  where m.id = c.match_id
    and c.person_id is null
    and lower(trim(c.raw_player_name)) = lower(trim(p_name))
    and public.season_of(m.match_date) = public.current_season();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.link_match_cards_by_name(text) from public, anon, authenticated;
grant execute on function public.link_match_cards_by_name(text) to service_role;
