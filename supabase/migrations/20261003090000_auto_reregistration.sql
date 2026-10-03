-- Automatic re-registration (Bye-Law 7.2(b); rules spec §13; owner, 3 Oct 2026).
--
-- A player who plays up more than his allowance (3, or 8 for a U21) from his
-- registered team is re-registered to a higher team as soon as the match
-- card that takes him over arrives. Only play-ups made from the current
-- registered team count (spec §10), so after a move the count starts again.
--
-- Destination (spec §13.3): among the play-ups that used up the allowance
-- plus the one after it, in match order, the team played for most often. A
-- tie goes to the lower-ranked team (the larger teams.team_rank).
--
-- Each outcome is recorded once per player, season and team moved from. So a
-- later move up from the new team still happens, but an officer who puts a
-- player back on his old team is not overruled. When the destination can't
-- be worked out safely (a team with no rank, or a move that would not be
-- upwards), nothing changes and the event is recorded as needs_review.

create table public.registration_events (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  season text not null,
  previous_team text not null,
  new_team text,
  status text not null check (status in ('applied', 'needs_review')),
  detail text,
  -- The play-ups that triggered it, in match order: [{card, match_date, team}].
  play_ups jsonb not null default '[]',
  triggering_card_id uuid references public.match_cards (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (person_id, season, previous_team)
);
alter table public.registration_events enable row level security;
revoke all on public.registration_events from public, anon, authenticated;
grant select, insert, update, delete on public.registration_events to service_role;

-- Returns the new team when the player is moved, 'needs_review' when he is
-- over the limit but can't be moved safely, and null otherwise.
create function public.auto_reregister(p_person uuid) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_season text := public.current_season();
  v_reg text;
  v_u21 boolean;
  v_allowance integer;
  v_cards jsonb;
  v_n integer;
  v_last uuid;
  v_unranked text;
  v_reg_rank integer;
  v_dest text;
  v_dest_rank integer;
  v_event uuid;
begin
  select registered_team, u21_eligible into v_reg, v_u21 from public.people_v where id = p_person;
  if coalesce(v_reg, '') = '' then
    return null;
  end if;
  if exists (select 1 from public.registration_events e
             where e.person_id = p_person and e.season = v_season and e.previous_team = v_reg) then
    return null;
  end if;
  v_allowance := case when v_u21 then 8 else 3 end;

  -- The qualifying play-ups from the registered team, as
  -- worker/src/playUp.ts isQualifyingPlayUpCard counts them: not as
  -- goalkeeper, this season, not a friendly.
  select count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object('card', q.id, 'match_date', q.match_date, 'team', q.team)
                            order by q.match_date, q.id), '[]')
    into v_n, v_cards
  from (
    select c.id, m.match_date, c.team
    from public.match_cards_v c
    join public.matches_v m on m.id = c.match_id
    where c.person_id = p_person
      and c.season = v_season
      and c.play_up
      and not c.goalkeeper
      and m.competition_type is distinct from 'FRIENDLY'
      and c.player_team = v_reg
    order by m.match_date, c.id
    limit v_allowance + 1
  ) q;
  if v_n <= v_allowance then
    return null;
  end if;
  v_last := (v_cards -> -1 ->> 'card')::uuid;

  select string_agg(distinct x ->> 'team', ', ') into v_unranked
  from jsonb_array_elements(v_cards) x
  where not exists (select 1 from public.teams t where t.team_name = x ->> 'team' and t.team_rank is not null);
  select team_rank into v_reg_rank from public.teams where team_name = v_reg;
  if v_unranked is not null or v_reg_rank is null then
    insert into public.registration_events (person_id, season, previous_team, status, detail, play_ups, triggering_card_id)
    values (p_person, v_season, v_reg, 'needs_review',
            'No team rank for ' || coalesce(v_unranked, v_reg), v_cards, v_last)
    on conflict do nothing;
    return 'needs_review';
  end if;

  select x.team, t.team_rank into v_dest, v_dest_rank
  from (select e ->> 'team' as team, count(*) as k from jsonb_array_elements(v_cards) e group by 1) x
  join public.teams t on t.team_name = x.team
  order by x.k desc, t.team_rank desc
  limit 1;
  -- Never a demotion (rank 1 is the top team).
  if v_dest_rank >= v_reg_rank then
    insert into public.registration_events (person_id, season, previous_team, new_team, status, detail, play_ups, triggering_card_id)
    values (p_person, v_season, v_reg, v_dest, 'needs_review', 'Would not be a move up', v_cards, v_last)
    on conflict do nothing;
    return 'needs_review';
  end if;

  insert into public.registration_events (person_id, season, previous_team, new_team, status, play_ups, triggering_card_id)
  values (p_person, v_season, v_reg, v_dest, 'applied', v_cards, v_last)
  on conflict do nothing
  returning id into v_event;
  if v_event is null then
    return null;
  end if;
  update public.people set registered_team = v_dest where id = p_person;
  return v_dest;
end;
$$;
revoke all on function public.auto_reregister(uuid) from public, anon, authenticated;
grant execute on function public.auto_reregister(uuid) to service_role;

-- Row triggers that run AFTER fire at the end of the statement, so a
-- match's cards written together are all counted.
create function public.match_cards_auto_reregister() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.importing() or new.person_id is null then
    return null;
  end if;
  perform public.auto_reregister(new.person_id);
  return null;
end;
$$;
revoke all on function public.match_cards_auto_reregister() from public, anon, authenticated;
create trigger match_cards_auto_reregister
  after insert or update of person_id, match_id, team, player_team, goalkeeper on public.match_cards
  for each row execute function public.match_cards_auto_reregister();
