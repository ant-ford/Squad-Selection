# Airtable → Supabase import and parity check

One-off tools for the October 2026 move. Not part of the app build (their own `package.json`; run `npm install` here first).

| Command | What it does |
|---|---|
| `node import-airtable.mjs` | **Dry run** against eddy-preview: reads all of Airtable, builds every row and reports, writes nothing |
| `node import-airtable.mjs --apply` | Writes eddy-preview and copies attachments to `eddy-files-preview` |
| `node import-airtable.mjs --apply --no-files` | Rows only |
| `node parity.mjs` | Compares Airtable with eddy-preview row by row; exits non-zero on any unexplained difference |
| `node parity.mjs --files=all` | Also checksums every file in R2 (default: 40 at random) |
| `--target=production --i-understand-this-writes-production` | Points either script at eddy-production (switch-over only) |
| `--use-cache` | Reuse the last Airtable snapshot instead of reading again (never for files: attachment links expire) |
| `--rate=N` | Airtable requests per second, at most 4 (default 2) |

**Safety**
- Airtable is read with `AIRTABLE_READONLY_TOKEN` only.
- Secrets come from `eddy-secrets.txt` (or the environment) and are never printed.
- The import only upserts: rows on `airtable_id`, files on the attachment id. It deletes nothing, and a re-run picks up where the last one stopped.
- Reports (in `reports/`, git-ignored) contain table names, record ids, column names and counts only.
- The Airtable snapshot in `.migration-cache/` is raw club data. It is git-ignored, and should be deleted once the move is done.

**Rules the import applies on purpose** (the parity check lists these as explained):
- Two people sharing an email: the Active one keeps it; the other is imported without one.
- Two answers from one player for one match: the most recently updated is kept.
- A shirt number linked to two people: the first keeps it.
- A U18 Registration Form for anyone born on or before 2008-09-01 (18 or over on 1 Sep 2026) is not copied.
- A Sponsor Page 7 for someone who has a Sports Associate Application Form is not copied (page 7 is part of it).

What goes where is in `mapping.mjs`. The field decisions behind it are in `docs/migration/FIELDS.md`.
