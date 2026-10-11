-- Date availability stays separate until the organiser chooses a date.
-- Available replies for that date then become Going in the same transaction.
create function public.valid_event_date_options(p_options jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare o jsonb; starts timestamptz; ends timestamptz; previous timestamptz; ids text[] := '{}';
begin
  if jsonb_typeof(p_options) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_options) = 0 then return true; end if;
  if jsonb_array_length(p_options) not between 2 and 6 then return false; end if;
  for o in select value from jsonb_array_elements(p_options) loop
    if jsonb_typeof(o) is distinct from 'object' or coalesce(o->>'id', '') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$'
       or o->>'id' = any(ids) then return false; end if;
    starts := (o->>'startsAt')::timestamptz;
    ends := (o->>'endsAt')::timestamptz;
    if starts is null or not isfinite(starts) or (ends is not null and (not isfinite(ends) or ends <= starts)) or (previous is not null and starts <= previous) then return false; end if;
    ids := array_append(ids, o->>'id'); previous := starts;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.valid_event_date_options(jsonb) from public, anon, authenticated;
grant execute on function public.valid_event_date_options(jsonb) to service_role;

alter table public.events add column date_options jsonb not null default '[]'
  check (public.valid_event_date_options(date_options));
alter table public.events add column chosen_date_id text;
alter table public.events add constraint events_chosen_date_option_check
  check (chosen_date_id is null or date_options @> jsonb_build_array(jsonb_build_object('id', chosen_date_id)));

create table public.event_date_responses (
  event_id uuid not null references public.events(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (event_id, person_id)
);
create index event_date_responses_person_idx on public.event_date_responses(person_id);
alter table public.event_date_responses enable row level security;
revoke all on public.event_date_responses from public, anon, authenticated;
grant select, insert, update, delete on public.event_date_responses to service_role;

-- Serialize replies and date selection on the same event row. A late reply
-- cannot be written after the organiser has chosen the date.
create function public.save_event_date_answers(p_event_id uuid, p_person_id uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events where id = p_event_id for update;
  if not found or e.status <> 'published' or e.chosen_date_id is not null or jsonb_array_length(e.date_options) = 0
     or coalesce(e.respond_by, e.starts_at) <= now() then
    raise exception 'The date poll has closed or a date has already been chosen.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then raise exception 'Answer each proposed date.' using errcode = '22023'; end if;
  if (select count(*) from jsonb_object_keys(p_answers)) <> jsonb_array_length(e.date_options)
     or exists (select 1 from jsonb_array_elements(e.date_options) o
                where coalesce(p_answers->>(o->>'id'), '') not in ('available', 'maybe', 'unavailable')) then
    raise exception 'Answer each current proposed date.' using errcode = '22023';
  end if;
  insert into public.event_date_responses(event_id, person_id, answers) values (p_event_id, p_person_id, p_answers)
    on conflict (event_id, person_id) do update set answers = excluded.answers, updated_at = now();
end;
$$;
revoke all on function public.save_event_date_answers(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_event_date_answers(uuid, uuid, jsonb) to service_role;

create function public.choose_event_date(p_event_id uuid, p_option_id text, p_expected_options jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.events; o jsonb;
begin
  select * into e from public.events where id = p_event_id for update;
  if not found or e.status <> 'published' or e.chosen_date_id is not null or jsonb_array_length(e.date_options) = 0 then
    raise exception 'This event is no longer waiting for a date.' using errcode = 'P0001';
  end if;
  if e.date_options is distinct from p_expected_options then raise exception 'The proposed dates have changed. Reload first.' using errcode = '40001'; end if;
  select value into o from jsonb_array_elements(e.date_options) where value->>'id' = p_option_id;
  if o is null or (o->>'startsAt')::timestamptz <= now() then raise exception 'Choose a future proposed date.' using errcode = '22023'; end if;
  update public.events set chosen_date_id = p_option_id, starts_at = (o->>'startsAt')::timestamptz,
    ends_at = (o->>'endsAt')::timestamptz, respond_by = null where id = e.id;
  insert into public.event_responses(event_id, person_id, status)
    select e.id, r.person_id, 'going' from public.event_date_responses r
    where r.event_id = e.id and r.answers->>p_option_id = 'available'
    on conflict (event_id, person_id) do nothing;
end;
$$;
revoke all on function public.choose_event_date(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.choose_event_date(uuid, text, jsonb) to service_role;

-- Published options stay stable; changing the audience or details is still allowed.
create function public.guard_event_date_options() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.chosen_date_id is not null and (new.chosen_date_id is distinct from old.chosen_date_id
     or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) then
    raise exception 'The chosen date cannot be replaced by a stale edit.' using errcode = '40001';
  end if;
  if new.date_options is distinct from old.date_options then
    if old.status <> 'draft' or exists (select 1 from public.event_date_responses where event_id = old.id)
       or exists (select 1 from public.event_responses where event_id = old.id) then
      raise exception 'Proposed dates cannot change after publishing or receiving answers.' using errcode = '40001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_event_date_options() from public, anon, authenticated;
create trigger events_guard_date_options before update on public.events for each row execute function public.guard_event_date_options();

-- Erasure keeps the People row: remove date answers when its personal data is erased.
create function public.event_dates_erase() returns trigger
language plpgsql set search_path = '' as $$
begin
  delete from public.event_date_responses where person_id = new.id;
  return new;
end;
$$;
revoke all on function public.event_dates_erase() from public, anon, authenticated;
create trigger people_erase_event_dates after update of personal_data_removed_at on public.people
  for each row when (new.personal_data_removed_at is not null and old.personal_data_removed_at is distinct from new.personal_data_removed_at)
  execute function public.event_dates_erase();

insert into public.cache_versions (key) values ('event_date_responses');
do $$
declare t record; args text;
begin
  for t in select * from (values ('event_date_responses', 'event_date_responses', array[]::text[])) as x(tbl, key, ignore) loop
    args := quote_literal(t.key);
    execute format('create trigger %I after insert on public.%I referencing new table as new_rows for each statement execute function public.cache_versions_bump(%s)', t.tbl || '_cache_insert', t.tbl, args);
    execute format('create trigger %I after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function public.cache_versions_bump(%s)', t.tbl || '_cache_update', t.tbl, args);
    execute format('create trigger %I after delete on public.%I referencing old table as old_rows for each statement execute function public.cache_versions_bump(%s)', t.tbl || '_cache_delete', t.tbl, args);
    execute format('create trigger %I after truncate on public.%I for each statement execute function public.cache_versions_bump(%s)', t.tbl || '_cache_truncate', t.tbl, args);
  end loop;
end;
$$;
