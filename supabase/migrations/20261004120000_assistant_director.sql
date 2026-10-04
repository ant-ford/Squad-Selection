-- The Assistant Director of Hockey (owner, 4 Oct 2026): an office of its
-- own. Its holder gets coach rights for every team (like the Teams Section
-- Captain link), the Volunteers view (any office does) and the trial
-- sessions list. The holder is assigned like any office: an offices row with
-- role 'assistant_director', linked to their People record.

alter table public.offices drop constraint offices_role_check;
alter table public.offices add constraint offices_role_check
  check (role in ('sponsor', 'section_chair', 'section_captain', 'membership_officer', 'hockey_convenor', 'kit_convenor',
                  'social_secretary', 'assistant_director'));

create or replace view public.api_offices with (security_invoker = true) as
  select o.api_id as id,
         case o.role when 'membership_officer' then 'membershipOfficer' when 'section_chair' then 'sectionChair'
                     when 'section_captain' then 'sectionCaptain' when 'sponsor' then 'sponsor'
                     when 'hockey_convenor' then 'hockeyConvenor' when 'kit_convenor' then 'kitConvenor'
                     when 'assistant_director' then 'assistantDirector' end as office,
         o.designation, o.status, p.api_id as member
  from public.offices o
  left join public.people p on p.id = o.person_id;
