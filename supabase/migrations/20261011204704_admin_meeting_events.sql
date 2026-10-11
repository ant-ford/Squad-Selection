-- Admin meetings share Events' audience, RSVP, register and calendar features.
-- Expand only the type constraint; existing events, access and grants stay intact.
alter table public.events drop constraint events_event_type_check;
alter table public.events add constraint events_event_type_check
  check (event_type in ('trial', 'social_function', 'team_social', 'tournament', 'tour', 'admin_meeting'));
