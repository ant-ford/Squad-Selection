-- A duty no umpire is needed for (owner, 7 Oct 2026): a walk-over. The
-- Umpire Coordinator marks it, and can undo it. hkha-sync writes only its
-- own columns, so the mark survives HKHA's updates. Not counted in the
-- season's duties.

alter table public.umpire_duties add column not_needed boolean not null default false;
