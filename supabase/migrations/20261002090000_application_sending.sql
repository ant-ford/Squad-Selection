-- Check, then send (owner, 2 Oct 2026). An application's PDF is made when
-- it is ready: a new HKFC member's once the Membership Officer has signed
-- (the consolidated application, for the Club's membership office), an
-- existing member's levy form once they submit (for the front desk). The
-- Membership Officer opens it in Eddy and sends it after checking it.
alter table public.applications
  add column pdf_file_id uuid references public.files (id) on delete set null,
  add column sent_at timestamptz,
  add column sent_by uuid references public.people (id) on delete set null,
  -- The address it went to.
  add column sent_to text;
