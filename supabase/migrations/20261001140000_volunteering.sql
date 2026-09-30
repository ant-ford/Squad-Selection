-- Volunteering in Eddy: asked in the new joiner form and, for members, at
-- the start of each season, and changeable any time. The answers stay in the
-- People columns the Airtable form filled (owner decisions, 2026-10-01):
--  - each group is a checklist; unticked is no, and "Nothing for now" is an
--    answer with no roles, so "Not Interested" is no longer stored;
--  - one-off dated events (camps, the junior festival, stock takes) leave
--    the form for the events schedule, but answers already given for them
--    are kept;
--  - players give their own coaching and umpiring levels.

alter table public.people add column volunteering_updated_at timestamptz;

-- A group's new answer: the roles ticked (in the form's order), plus any
-- earlier answer the form no longer offers. "Not Interested" is dropped.
create function public.volunteer_merge(p_old text[], p_chosen jsonb, p_offered jsonb)
returns text[]
language sql immutable
set search_path = ''
as $$
  select coalesce(array_agg(v order by o), '{}') from (
    select x as v, 0 as o from unnest(p_old) x
     where x <> 'Not Interested' and not (coalesce(p_offered, '[]') ? x)
    union
    select c.value as v, c.ord as o from jsonb_array_elements_text(coalesce(p_chosen, '[]')) with ordinality c(value, ord)
     where coalesce(p_offered, '[]') ? c.value
  ) t;
$$;

-- Saves a person's volunteering. p: {roles: {group: [..]}, offered: {group:
-- [..]}, qualifiedCoach, qualifiedUmpire}, groups keyed as in
-- shared/volunteering.ts. Errors: P0002 not found.
create function public.save_volunteering(p_actor text, p jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  person uuid;
begin
  select id into person from public.people where api_id = p_actor for update;
  if person is null then raise exception 'Your People record was not found' using errcode = 'P0002'; end if;
  update public.people set
    hockey_committee_roles = public.volunteer_merge(hockey_committee_roles, p->'roles'->'hockeyCommittee', p->'offered'->'hockeyCommittee'),
    mens_sub_committee = public.volunteer_merge(mens_sub_committee, p->'roles'->'mensSubCommittee', p->'offered'->'mensSubCommittee'),
    team_roles = public.volunteer_merge(team_roles, p->'roles'->'teamRoles', p->'offered'->'teamRoles'),
    touring_committee = public.volunteer_merge(touring_committee, p->'roles'->'touringCommittee', p->'offered'->'touringCommittee'),
    junior_hockey_volunteers = public.volunteer_merge(junior_hockey_volunteers, p->'roles'->'juniorHockey', p->'offered'->'juniorHockey'),
    easter_5s_committee = public.volunteer_merge(easter_5s_committee, p->'roles'->'easter5s', p->'offered'->'easter5s'),
    qualified_coach = coalesce(nullif(btrim(p->>'qualifiedCoach'), ''), 'Not Applicable'),
    qualified_umpire = coalesce(nullif(btrim(p->>'qualifiedUmpire'), ''), 'Not Applicable'),
    volunteering_updated_at = now()
  where id = person;
end;
$$;
revoke all on function public.save_volunteering(text, jsonb) from public, anon, authenticated;
