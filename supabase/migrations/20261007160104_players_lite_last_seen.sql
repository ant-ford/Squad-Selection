-- Silent players (6 Oct 2026 review, item D5). The squad screen marks a
-- player who hasn't answered a fixture and hasn't opened Eddy for six weeks
-- ("not seen 6 wks"), so the coach knows to ask rather than count them in.
-- people.last_seen_at is stamped by the Worker at most once a day when
-- someone signs in (auth.ts); cache_versions already ignores it, so the
-- stamp doesn't invalidate anyone's cached reads.
--
-- api_players_lite gains last_seen_at at the end; nothing else changes.
create or replace view public.api_players_lite with (security_invoker = true) as
  select b.api_id as id,
         p.preferred_name, p.given_names, p.surname,
         s.shirt_no::text as shirt_no_value,
         p.email, p.mobile_no, p.active,
         p.registered_team, p.selected_team_sos, p.selected_team_eos, p.playing_position, p.playing_ability,
         p.is_visiting_player, p.is_suspended, p.matches_to_serve, p.ever_registered_to_premier, p.u21_eligible,
         p.section_rank, p.status, p.applicant_stage, p.opt_in_only,
         to_char(p.date_of_birth, 'MM-DD') as birthday,
         b.last_seen_at
  from public.people_v p
  join public.people b on b.id = p.id
  left join public.shirt_numbers s on s.id = p.shirt_number_id;

-- The stamp: sign-in's one database call (auth_context, which the Worker
-- reuses for 10 s per isolate) now also records the day, only when the row
-- isn't stamped yet today in Hong Kong, so it writes at most once a day per
-- person and costs no extra request. auth_context itself is unchanged, under
-- a new name; this wrapper is volatile so PostgREST runs it read-write.
alter function public.auth_context(text) rename to auth_context_read;

create function public.auth_context(p_email text) returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
begin
  update public.people
     set last_seen_at = now()
   where lower(email) = lower(btrim(p_email))
     and (last_seen_at is null
          or last_seen_at < (date_trunc('day', now() at time zone 'Asia/Hong_Kong') at time zone 'Asia/Hong_Kong'));
  return public.auth_context_read(p_email);
end;
$$;
revoke all on function public.auth_context(text) from public, anon, authenticated;
grant execute on function public.auth_context(text) to service_role;
