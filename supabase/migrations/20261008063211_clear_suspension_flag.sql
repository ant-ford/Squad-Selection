-- Clearing an old hand-set suspension flag (owner, 8 Oct 2026).
--
-- people.is_suspended / matches_to_serve were the Airtable flags.
-- 20261007130203_suspensions.sql moved every flag on someone with a
-- registered team into `suspensions`; the ones left are on people with no
-- registered team, and the Suspensions screen lists them as "Old flags".
-- The Men's Convenor either makes one a suspension (admin_save_suspension
-- already clears the flag in the same save) or clears it here.
--
-- p_player is the person's api_id, p_actor the Convenor's. Like the other
-- admin writes, it logs itself to activity_log (field names only).
create function public.admin_clear_suspension_flag(p_player text, p_actor text) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := case when p_actor is null then null else public.person_uuid(p_actor) end;
  v_person uuid := public.person_uuid(p_player);
begin
  update public.people set is_suspended = false, matches_to_serve = null
  where id = v_person and (is_suspended or coalesce(matches_to_serve, 0) > 0);
  if not found then
    raise exception 'No suspension flag on %', p_player using errcode = 'P0002';
  end if;

  insert into public.activity_log (actor_person_id, action, entity, entity_id, fields)
  values (v_actor, 'admin-suspension-flag-clear', 'people', v_person, array['is_suspended', 'matches_to_serve']);
  -- History triggers skip a transaction that logged itself.
  perform set_config('eddy.audit_written', 'on', true);
end;
$$;

revoke all on function public.admin_clear_suspension_flag(text, text) from public, anon, authenticated;
grant execute on function public.admin_clear_suspension_flag(text, text) to service_role;
