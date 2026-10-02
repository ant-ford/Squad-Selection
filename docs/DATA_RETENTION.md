# Data retention

How long Eddy keeps a person's personal details, and how they are removed.
Migration `20261002160000_data_retention.sql`, Worker `src/retention.ts`.

## The rule

A person's personal details are removed **13 months after they were last active** in the section (owner, 2 Oct 2026). That's a season out plus a month, so someone who sat out last season can come back without starting from scratch.

"Last active" is the latest of:

- when they stopped being Active;
- a match they played or were picked for;
- an availability answer or rule;
- an application stage, form, declaration or commitment period.

A person is never due while they:

- are Active;
- hold an active office;
- coach or captain an active team;
- have an open step waiting on them or about them.

People already inactive at the switch-over are counted from their Airtable record's creation date, or from the import date if there's nothing older.

## What is removed, and what stays

**Removed:**

- contact, address and work details
- ID and bank details
- family, guardian and medical details
- applications, declarations and commitment reviews
- availability, rankings and selection notes
- kit sizes, season plans, volunteering and quiz scores
- their files in R2: photos, ID copies, signatures and PDFs
- their sign-in account
- their raw Airtable copy

**Stays:** their name, gender, teams, position and membership dates, and every appearance, selection and match card. That is the club's playing record, so results and stats stay whole.

Encrypted backups age out on their own: daily copies after 35 days, monthly copies after 400 days (see [RESTORE.md](RESTORE.md)).

## Delete my profile

Anyone signed in can delete their own profile from the bottom of **My details**. They have to type DELETE first. It does the same removal straight away, makes them inactive, and retires any office they hold. Officers and coaches can do this too (owner, 2 Oct 2026). They are signed out, and if they come back they fill in their details again.

## Running it

The Worker's second daily cron (`30 3 * * *` UTC, 11:30 Hong Kong) runs the job on the Supabase backend:

1. `retention_stamp()`: stamps people who arrived inactive.
2. With `RETENTION_MODE = "remove"`: `remove_personal_data()` for up to 20 due people, oldest first. Each one is checked again just before removal.
3. Deletes the R2 objects that removal queued in `r2_deletions`. A failure stays queued for the next run.

`RETENTION_MODE` starts as **`"report"`**, which stamps people but removes nothing. Before switching to `"remove"` (in `worker/wrangler.toml`), check the list in the Supabase SQL editor:

```sql
select name, last_activity, due_on from public.retention_due_v order by last_activity;
-- who is coming up next
select name, due_on from public.retention_schedule_v where due_on <= current_date + 90 order by due_on;
```

Each removal is logged in `activity_log` as `remove_personal_data` or `delete_own_profile`, with field names only.

## Members who don't want their HKID shown or asked for

For a member who asks, the owner sets this by hand in the SQL editor:

```sql
update public.people set hkid_hidden = true where lower(email) = lower('member@example.com');
```

After that, **My details** and the new joiner form neither show nor ask for their HKID or passport, and won't accept an ID upload. Whatever is already held stays held, for the officers who need it (for example HKHA registration), until the retention removal.
