-- Events (owner, 7 Oct 2026):
--  - Self-funded: each player books and pays their own way (tours). Nobody
--    is billed through Eddy; an estimated cost per person may be shown.
--  - A link on the event, such as the event's WhatsApp group.

alter table public.events drop constraint events_payment_mode_check;
alter table public.events add constraint events_payment_mode_check
  check (payment_mode in ('free', 'on_the_night', 'payme_fps', 'account', 'self_funded'));

alter table public.events
  add column link_url text check (link_url is null or link_url ~ '^https://');
