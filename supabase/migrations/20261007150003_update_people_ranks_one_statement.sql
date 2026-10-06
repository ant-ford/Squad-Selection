-- update_people_ranks in one statement (Track C, 7 Oct 2026).
--
-- A ranking save (worker/src/ranking.ts -> people.updateMany) sends every
-- player whose rank moved: a long move shifts everyone in between, so a save
-- is often 20-100 rows. The function ran one UPDATE per player, and each
-- UPDATE statement also fired the people table's cache_versions statement
-- trigger (20261007140003_cache_versions.sql), which compares the old and new
-- transition tables: N statements, N trigger runs, N version bumps.
--
-- Now it is ONE UPDATE ... FROM over the whole batch: one statement, one
-- trigger run, one version bump. The behaviour is the same:
--
--   - only the keys present in an element are written, as before;
--   - an id that isn't a person fails the whole call with P0002 "No person
--     <id>" (the Worker maps it), and nothing is written: the update runs,
--     the count is checked, and the exception rolls the call back;
--   - an id given twice is applied in order, later keys winning, as the loop
--     did (the elements are merged per id first, so the UPDATE sees each
--     person once).
--
-- Same signature, so the Worker's call (data/supabase/people.ts) is
-- unchanged and the live Worker keeps working while this is applied.

create or replace function public.update_people_ranks(p jsonb) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_wanted integer;
  v_updated integer;
  v_missing text;
begin
  with w as (
    -- One merged object per id: jsonb keeps the last value of a repeated key.
    select e.w ->> 'id' as api_id, jsonb_object_agg(kv.key, kv.value order by e.n) as w
    from jsonb_array_elements(p) with ordinality as e(w, n)
    cross join lateral jsonb_each(e.w) as kv
    group by e.w ->> 'id'
  )
  update public.people t set
    section_rank = case when w.w ? 'sectionRank' then (w.w ->> 'sectionRank')::integer else t.section_rank end,
    playing_ability = case when w.w ? 'playingAbility' then w.w ->> 'playingAbility' else t.playing_ability end,
    rank_updated_at = case when w.w ? 'rankUpdatedAt' then (w.w ->> 'rankUpdatedAt')::timestamptz else t.rank_updated_at end,
    active = case when w.w ? 'active' then (w.w ->> 'active')::boolean else t.active end,
    opt_in_only = case when w.w ? 'optInOnly' then (w.w ->> 'optInOnly')::boolean else t.opt_in_only end
  from w
  where t.api_id = w.api_id;
  get diagnostics v_updated = row_count;

  select count(distinct coalesce(e ->> 'id', '')) into v_wanted from jsonb_array_elements(p) as e;
  if v_updated < v_wanted then
    select e ->> 'id' into v_missing
    from jsonb_array_elements(p) with ordinality as x(e, n)
    where not exists (select 1 from public.people q where q.api_id = e ->> 'id')
    order by n
    limit 1;
    raise exception 'No person %', v_missing using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.update_people_ranks(jsonb) from public, anon, authenticated;
grant execute on function public.update_people_ranks(jsonb) to service_role;
