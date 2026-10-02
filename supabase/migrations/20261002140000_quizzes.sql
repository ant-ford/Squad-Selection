-- The Hockey Rules quizzes in Eddy (owner, 2 Oct 2026), replacing Fillout
-- forms 14-17. The questions and answer keys live here, not in the
-- repository (it's public); scripts/migration/load-quizzes.mjs loads them.
-- Scores stay in quiz_scores, one per person and quiz (past scores come
-- from Airtable's quiz fields in the import), under the same quiz names.

create table public.quizzes (
  key text primary key,
  title text not null,
  -- The opening text, shown before the questions.
  intro text,
  -- [{id, text, options: [{id, label}], correct: [optionId], points, explanation}]
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  sort smallint not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger quizzes_updated_at before update on public.quizzes
  for each row execute function public.set_updated_at();

alter table public.quizzes enable row level security;
revoke all on public.quizzes from public, anon, authenticated;
grant select, insert, update, delete on public.quizzes to service_role;
