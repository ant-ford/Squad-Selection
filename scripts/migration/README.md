# Loader scripts

Small tools that put data or private files into Eddy. Not part of the app build (their own `package.json`; run `npm install` here first).

| Script | What it does |
|---|---|
| `backfill-photo-thumbnails.mjs` | Makes the 128 px WebP thumbnail next to each person's photo in R2 that has none (photos from before the app made them). Only reads the database. Dry run until `--apply` |
| `import-kit-order.mjs` | Loads a supplier's kit order CSV into `kit_orders` and `kit_sets`. Idempotent; never moves a set |
| `load-quizzes.mjs` | Loads the Hockey Rules quizzes (questions, answer keys) from a JSON file kept outside the repository |
| `upload-club-doc.mjs` | Puts a club document (`shared/application.ts` CLUB_DOCS) into private file storage |
| `upload-pdf-template.mjs` | Puts a blank PDF template, or the Chinese font, into private file storage for the PDF renderer |

Each script's header has its exact command line. Every one is a dry run against eddy-preview (or eddy-files-preview) until told otherwise:

| Flag | Meaning |
|---|---|
| `--apply` | Write (the data loaders; the uploaders always write) |
| `--target=production --i-understand-this-writes-production` | Point at eddy-production / eddy-files instead |

**Safety**
- Secrets come from `eddy-secrets.txt` (or the environment) and are never printed.
- Writes are upserts, so a re-run is safe.
- Club documents and templates stay out of the public repository; they live in the private R2 buckets.

The one-off Airtable import (`import-airtable.mjs`, `parity.mjs`, `mapping.mjs`, `backfill-applications.mjs`) ran for the October 2026 switch-over and was deleted afterwards; it is in the git history. The field decisions behind it are in `docs/migration/FIELDS.md`.
