-- Two fixes found by the first parity run (29 Sep 2026).
--
-- 1. Airtable keeps an attachment's id when a file is copied to another
--    record, so one attachment can belong to several people (one photo sits
--    on 23 records) or to two fields of one person (the guardian's account
--    and consent signatures). A file row is therefore one owner's use of a
--    stored object, and several rows may share an object: the attachment id
--    and the R2 key stop being unique on their own. An imported row is
--    identified by attachment + kind + owner instead.
alter table public.files drop constraint files_r2_key_key;
alter table public.files drop constraint files_airtable_attachment_id_key;
create index files_r2_key_idx on public.files (r2_key);
create unique index files_import_key on public.files
  (airtable_attachment_id, kind, person_id, family_member_id, commitment_id) nulls not distinct
  where airtable_attachment_id is not null;

-- 2. "Ever Registered To Premier" is false, not unknown, for someone with no
--    Registered Team - as Airtable's formula has it.
create or replace view public.people_v with (security_invoker = true) as
  select p.*,
         nullif(trim(concat_ws(' ', coalesce(p.preferred_name, p.given_names), p.surname)), '') as name,
         nullif(trim(concat_ws(' ', p.given_names, p.surname)), '') as full_name,
         split_part(p.given_names, ' ', 1) as first_name,
         extract(year from age(current_date, p.date_of_birth))::int as age,
         case
           when p.date_of_birth is null then null
           when extract(year from age(current_date, p.date_of_birth)) < 16 then '15 or under'
           when extract(year from age(current_date, p.date_of_birth)) <= 20 then '16-20'
           when extract(year from age(current_date, p.date_of_birth)) <= 25 then '21-25'
           when extract(year from age(current_date, p.date_of_birth)) <= 30 then '26-30'
           when extract(year from age(current_date, p.date_of_birth)) <= 35 then '31-35'
           when extract(year from age(current_date, p.date_of_birth)) <= 40 then '36-40'
           when extract(year from age(current_date, p.date_of_birth)) <= 45 then '41-45'
           when extract(year from age(current_date, p.date_of_birth)) <= 50 then '46-50'
           when extract(year from age(current_date, p.date_of_birth)) <= 55 then '51-55'
           when extract(year from age(current_date, p.date_of_birth)) <= 60 then '56-60'
           when extract(year from age(current_date, p.date_of_birth)) <= 65 then '61-65'
           else '65+'
         end as age_band,
         coalesce(extract(year from age(ls.sep1, p.date_of_birth)) < 21, false) as u21_eligible,
         coalesce(extract(year from age(ls.sep1, p.date_of_birth)) < 18, false) as needs_u18_form,
         coalesce(p.registered_team = 'HKFC A', false) as ever_registered_to_premier,
         case
           when p.commitment_end_date is null or p.commitment_end_date < current_date then 0
           when ann.this_year > current_date then ann.this_year - current_date
           else ann.next_year - current_date
         end as next_period_end_days
  from public.people p
  cross join lateral (
    select make_date(
      case when current_date >= make_date(extract(year from current_date)::int, 9, 1)
           then extract(year from current_date)::int
           else extract(year from current_date)::int - 1 end, 9, 1) as sep1
  ) ls
  cross join lateral (
    select (p.commitment_end_date + make_interval(years => extract(year from current_date)::int
                                                    - extract(year from p.commitment_end_date)::int))::date as this_year,
           (p.commitment_end_date + make_interval(years => extract(year from current_date)::int + 1
                                                    - extract(year from p.commitment_end_date)::int))::date as next_year
  ) ann;

revoke all on public.people_v from anon, authenticated;
grant select on public.people_v to service_role;
