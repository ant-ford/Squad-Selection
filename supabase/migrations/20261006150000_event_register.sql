-- Renumbered from 20261006120000, which clashed with 20261006120000_hkha_registrations.

-- The register (owner, 6 Oct 2026): who came is ticked off, not who didn't.
-- Spotting who's missing meant remembering everyone who said Going; a
-- register is ticked at the door. Members can also tick themselves in by
-- scanning the event's check-in QR code at the venue.
--
--  - Only ticked people count as having come (commitment reviews). The
--    event's creator and its team's social secretaries get a My Tasks line
--    until the register is marked taken.
--  - Charging is unchanged: everyone Going is charged, whether they came.

alter table public.event_responses
  add column attended boolean not null default false,
  -- How many of their guests came (the register or their check-in).
  add column guests_came smallint check (guests_came >= 0),
  -- When they ticked themselves in with the QR code.
  add column checked_in_at timestamptz;

-- Until now anyone Going counted as having come once the event started,
-- unless marked as not having come: keep that for events already held.
update public.event_responses r
   set attended = true
  from public.events e
 where e.id = r.event_id and r.status = 'going' and not r.no_show and e.starts_at <= now();

alter table public.event_responses drop column no_show;

alter table public.events
  -- When the social secretary marked the register taken.
  add column register_taken_at timestamptz,
  -- The secret in the check-in QR code: scanning it proves you were shown it.
  add column checkin_code text;
