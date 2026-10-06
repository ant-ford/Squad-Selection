-- Link one match card to a person by hand (Data checks; Track B4, 7 Oct 2026).
--
-- A card links itself when its name, as HKHA printed it, is exactly one
-- person's Registered Name (match_cards_link_person on write, and
-- link_match_cards_by_name when a name is saved). A card whose name matches
-- nobody, or more than one person, stays unlinked and is listed on the Data
-- checks screen. This lets the Men's Convenor or a Section Captain link it to
-- the right person in one step:
--
--   link_match_card(p_card, p_person, p_save_name, p_actor)
--     - refuses a card that is already linked: {status: 'conflict', code: 'ALREADY_LINKED'}
--     - links the card (person_id), which fires match_cards_auto_reregister
--       as for any other link, so play-ups found this way count as usual;
--     - with p_save_name, also saves the card's name as the person's
--       Registered Name (tidied: trimmed, single spaces) and links this
--       season's other unlinked cards that carry it (link_match_cards_by_name).
--       Refused when someone else already has that name, since cards then
--       link to nobody: {status: 'conflict', code: 'NAME_TAKEN'}.
--     - writes one activity_log row for the person, field names only.
--   Returns {status: 'ok', linked: <cards linked, this one included>}.
--
-- Unknown card or person: raises P0002.

create function public.link_match_card(p_card text, p_person text, p_save_name boolean, p_actor text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := case when p_actor is null then null else public.person_uuid(p_actor) end;
  v_person uuid := public.person_uuid(p_person);
  c public.match_cards%rowtype;
  v_name text;
  v_linked integer := 1;
  v_fields text[] := array['match_cards.person_id'];
begin
  select * into c from public.match_cards where api_id = p_card for update;
  if not found then
    raise exception 'No match card %', p_card using errcode = 'P0002';
  end if;
  if c.person_id is not null then
    return jsonb_build_object('status', 'conflict', 'code', 'ALREADY_LINKED');
  end if;

  -- As shared/registration.ts tidyRegisteredName: trimmed, runs of spaces as one.
  v_name := nullif(btrim(regexp_replace(coalesce(c.raw_player_name, ''), '\s+', ' ', 'g')), '');

  if p_save_name and v_name is not null then
    if exists (
      select 1 from public.people
      where id <> v_person and lower(btrim(registered_name)) = lower(v_name)
    ) then
      return jsonb_build_object('status', 'conflict', 'code', 'NAME_TAKEN');
    end if;
    update public.people set registered_name = v_name
    where id = v_person and registered_name is distinct from v_name;
    if found then
      v_fields := array_append(v_fields, 'registered_name');
    end if;
  end if;

  update public.match_cards set person_id = v_person where id = c.id;

  if p_save_name and v_name is not null then
    v_linked := v_linked + public.link_match_cards_by_name(v_name);
  end if;

  insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
  values (v_actor, 'admin-card-link', 'people', v_person, v_fields);

  return jsonb_build_object('status', 'ok', 'linked', v_linked);
end;
$$;

revoke all on function public.link_match_card(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.link_match_card(text, text, boolean, text) to service_role;
