-- Paying for events (owner, 3 Oct 2026), step 2 after 20261003120000_events.
--
--  - Who pays: whoever signed a person up, otherwise the person; their
--    guests are on the same bill. Everyone Going when answers close is
--    charged, no-shows included, unless a social secretary waives it.
--  - PayMe / FPS: the event gives the social secretary's PayMe link or FPS
--    ID (their choice to show it), and each payer uploads a screenshot of
--    the payment. Qwen reads the amount, date, reference and payee; Eddy
--    compares it with what they owe and flags a reference used twice; the
--    social secretary confirms it against the real PayMe or bank record.
--  - Membership account: the social secretary downloads the list (name,
--    membership no., amount) for the treasurer and marks it sent, so later
--    changes stand out.

alter table public.events
  -- The PayMe link or FPS ID shown to those invited (PayMe / FPS events).
  add column payment_details text,
  -- When the charge list went to the treasurer (membership account events).
  add column charges_sent_at timestamptz;

alter table public.event_responses
  -- A social secretary let them off (injury, a family emergency): no charge for them or their guests.
  add column charge_waived boolean not null default false;

-- One per payer per event: their payment proof and what was read from it.
create table public.event_payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  payer_id uuid not null references public.people (id) on delete cascade,
  file_id uuid references public.files (id) on delete set null,
  -- What they owed when they uploaded it.
  amount_due numeric(8, 2),
  -- Read from the screenshot; null when it couldn't be read.
  amount_read numeric(8, 2),
  paid_on date,
  reference text,
  payee text,
  read_status text not null check (read_status in ('matched', 'amount_differs', 'duplicate', 'unreadable')),
  confirmed_by uuid references public.people (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, payer_id)
);
create index event_payments_payer_idx on public.event_payments (payer_id);
create index event_payments_file_idx on public.event_payments (file_id);
create index event_payments_confirmed_by_idx on public.event_payments (confirmed_by);
create index event_payments_reference_idx on public.event_payments (reference) where reference is not null;
create trigger event_payments_updated_at before update on public.event_payments
  for each row execute function public.set_updated_at();

alter table public.event_payments enable row level security;
revoke all on public.event_payments from public, anon, authenticated;
grant select, insert, update, delete on public.event_payments to service_role;
