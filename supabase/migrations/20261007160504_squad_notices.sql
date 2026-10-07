-- "Changes since you notified" (6 Oct 2026 review, item D4). When a coach
-- copies the squad message or opens a WhatsApp link from Notify, the squad
-- as it stands is kept here, one row per match side (the latest notice
-- wins). The squad page then shows "+Sam −Lee since Thu 20:14" with links
-- for just those players, and the fixture card a dot while the squad
-- differs from what the players were told.

create table public.squad_notices (
  match_id uuid not null references public.matches (id) on delete cascade,
  side text not null check (side in ('home', 'away')),
  notified_at timestamptz not null default now(),
  notified_by uuid references public.people (id) on delete set null,
  squad uuid[] not null default '{}',
  primary key (match_id, side)
);
create index squad_notices_notified_by_idx on public.squad_notices (notified_by);
alter table public.squad_notices enable row level security;
revoke all on public.squad_notices from public, anon, authenticated;
grant select, insert, update, delete on public.squad_notices to service_role;

-- Keeps the side's squad as it is now. Returns the notice as api ids.
-- Errors: P0002 no such match.
create function public.note_squad_notified(p_match text, p_side text, p_actor text) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  m uuid;
  v public.squad_notices;
begin
  if p_side not in ('home', 'away') then
    raise exception 'side must be home or away' using errcode = '22023';
  end if;
  select id into m from public.matches where api_id = p_match;
  if m is null then
    raise exception 'No match %', p_match using errcode = 'P0002';
  end if;
  insert into public.squad_notices as n (match_id, side, notified_at, notified_by, squad)
  values (m, p_side, now(), public.selection_actor(p_actor),
          coalesce(array(select s.person_id from public.match_selections s
                         where s.match_id = m and s.side = p_side order by s.ordinal), '{}'))
  on conflict (match_id, side) do update
    set notified_at = excluded.notified_at, notified_by = excluded.notified_by, squad = excluded.squad
  returning * into v;
  return jsonb_build_object('notifiedAt', v.notified_at,
    'squad', (select coalesce(jsonb_agg(p.api_id order by x.ord), '[]'::jsonb)
              from unnest(v.squad) with ordinality as x(pid, ord) join public.people p on p.id = x.pid));
end;
$$;

-- The notices as the Worker reads them: match and players by api id.
create view public.api_squad_notices with (security_invoker = true) as
  select b.api_id as match_id, n.side, n.notified_at,
         coalesce(array(select p.api_id from unnest(n.squad) with ordinality as x(pid, ord)
                        join public.people p on p.id = x.pid order by x.ord), '{}') as squad
  from public.squad_notices n
  join public.matches b on b.id = n.match_id;

revoke all on public.api_squad_notices from public, anon, authenticated;
grant select on public.api_squad_notices to service_role;
revoke all on function public.note_squad_notified(text, text, text) from public, anon, authenticated;
grant execute on function public.note_squad_notified(text, text, text) to service_role;
