-- Questions an event asks when people answer (owner, 3 Oct 2026): the
-- social secretary picks dietary requirements, or writes up to four of
-- their own; each answer is a short text.

alter table public.events
  -- [{key, label}]: "dietary" for dietary requirements, q1..q4 for their own.
  add column questions jsonb not null default '[]';

alter table public.event_responses
  -- {key: answer} for the event's questions.
  add column answers jsonb not null default '{}';
