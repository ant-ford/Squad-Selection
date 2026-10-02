-- Resend's free plan counts every To, CC and BCC address as an email
-- (100 a day, shared with the sign-in codes Supabase Auth sends through the
-- same account). Eddy now logs how many addresses each message went to, and
-- its daily total adds those up, so its own cap protects the sign-in codes
-- (owner, 2 Oct 2026).
alter table public.email_log add column recipients integer not null default 1 check (recipients >= 1);

-- Addresses emailed today (UTC, the day Resend counts).
create or replace function public.emails_sent_today() returns integer
language sql stable
set search_path = ''
as $$ select coalesce(sum(recipients), 0)::integer from public.email_log where sent_at >= date_trunc('day', now()) and status = 'sent' $$;
