-- An outside umpire's club (owner, 7 Oct 2026), shown as their affiliation
-- in the season report. Optional: the Umpire Coordinator enters it when he
-- assigns them, and it is offered again with their name next time. HKHA's
-- match cards give names only, so there is nowhere else to get it from.

alter table public.umpire_assignments add column external_club text
  check (external_club is null or (external_name is not null and btrim(external_club) <> ''));
