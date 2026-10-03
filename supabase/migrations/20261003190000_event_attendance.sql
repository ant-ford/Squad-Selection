-- Who came (owner, 3 Oct 2026), step 3 of events: anyone Going counts as
-- attended once the event has started, unless the social secretary marks
-- them as not having come. Attendance at the social functions fills in the
-- commitment review; no-shows are still charged.

alter table public.event_responses
  add column no_show boolean not null default false;
