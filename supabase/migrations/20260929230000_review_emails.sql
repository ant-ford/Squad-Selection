-- Starting a commitment review, as one step, for the Worker's review emails
-- (the two "Email Commitment Form" Airtable automations). Claiming the row
-- first means a Notify Now and the daily job can never both email a member.

-- Moves one review from Not Started to Notified Member and opens the
-- member's step. Returns what the email needs, or nothing when the review
-- had already started (someone else got there first).
create function public.start_review(p_commitment text) returns table (
  commitment_id uuid, step_id uuid, person_id uuid, email text, preferred_name text, year_no smallint, period text
)
language plpgsql
set search_path = ''
as $$
declare
  c record;
  s uuid;
begin
  update public.commitments
     set review_progress = 'Notified Member'
   where api_id = p_commitment and review_progress = 'Not Started'
  returning id, commitments.person_id, commitments.year_no, commitments.period_start, commitments.period_end into c;
  if c.id is null then
    return;
  end if;
  insert into public.steps (process, step, person_id, commitment_id, waiting_on_person_id, waiting_on_role)
  values ('commitment_review', 'member_report', c.person_id, c.id, c.person_id, 'member')
  returning id into s;
  return query
    select c.id, s, p.id, p.email, coalesce(p.preferred_name, split_part(p.given_names, ' ', 1)), c.year_no,
           to_char(c.period_start, 'DD Mon YYYY') || ' to ' || to_char(c.period_end, 'DD Mon YYYY')
    from public.people p where p.id = c.person_id;
end;
$$;

-- Undoes start_review when its email could not be sent, so the next run tries again.
create function public.undo_review_start(p_step uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  cid uuid;
begin
  delete from public.steps where id = p_step and done_at is null returning commitment_id into cid;
  if cid is not null then
    update public.commitments set review_progress = 'Not Started'
     where id = cid and review_progress = 'Notified Member';
  end if;
end;
$$;

-- Reviews due their email: the period ends within the next 60 days and
-- nothing has started. (Periods already over are never emailed.)
create view public.reviews_due_v with (security_invoker = true) as
  select c.api_id as id, c.period_end
  from public.commitments c
  where c.review_progress = 'Not Started'
    and c.period_end between current_date and current_date + 60
    and c.person_id is not null;

-- Emails sent since midnight UTC (Resend's free plan counts 100 a day).
create function public.emails_sent_today() returns integer
language sql stable
set search_path = ''
as $$ select count(*)::integer from public.email_log where sent_at >= date_trunc('day', now()) and status = 'sent' $$;

revoke all on public.reviews_due_v from anon, authenticated;
grant select on public.reviews_due_v to service_role;
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;
end;
$$;
