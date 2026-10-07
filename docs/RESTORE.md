# Backups and restoring them

Supabase's free plan keeps no backups, so Eddy makes its own: an encrypted `pg_dump` of each database in the private R2 bucket `eddy-backups`. This page says what is kept, how to check a backup can be read back, and how to restore production.

## What is kept

| Database | When | Where in `eddy-backups` | Kept for |
|---|---|---|---|
| eddy-production | Every night, 03:00 Hong Kong | `daily/eddy-production/<date>.dump.age` | 35 days |
| eddy-production | The 1st of each month | `monthly/eddy-production/<date>.dump.age` | 400 days |
| eddy-preview | Every Sunday, 03:30 Hong Kong | `daily/eddy-preview/<date>.dump.age` | 35 days |

The retention comes from the bucket's lifecycle rules; the workflow never deletes anything. Each backup has a `<date>.manifest.json` beside it with the file's SHA-256, its size, the `pg_dump` version and every table's row count. It holds no data.

- **What is in a backup:** the `public` schema (every Eddy table, view, function, RLS policy and grant) and the `archive` schema (the raw Airtable copy while it exists), in `pg_dump` custom format.
- **What is not:** Supabase's own schemas (`auth`, `storage` and the rest). Eddy keeps no data there; after a restore into a new project, people simply sign in again with an email code. **Files in R2** (`eddy-files`) are not in the dump either. They live in R2 itself.
- **Encryption:** the dump is streamed straight into [age](https://age-encryption.org), encrypted to the public key in the `BACKUP_AGE_PUBLIC_KEY` repository variable, so it never touches the runner's disk readable. Only the matching secret key can decrypt it.

The workflow is `.github/workflows/backup.yml`. Run it by hand from **Actions → Database backup → Run workflow**.

## The secret key

`BACKUP_AGE_SECRET_KEY` decrypts every backup, so it is the one thing that must not be lost or leaked.

- It is in `eddy-secrets.txt` on the owner's machine, and in the `restore-drill` GitHub environment. That environment is limited to `main` and needs the owner's approval for each run.
- **Keep a second copy offline**, for example in a password manager. Without it the backups cannot be read.
- If it leaks: create a new age key pair (`age-keygen`), replace `BACKUP_AGE_PUBLIC_KEY` and the `restore-drill` secret, and treat existing backups as readable by whoever has the old key.

## Restore drill: prove a backup can be read back

Run **Actions → Restore drill → Run workflow**, and approve the run when GitHub asks.

- **object:** `latest:eddy-preview` (the default), `latest:eddy-production`, or a key such as `daily/eddy-production/2026-10-05.dump.age`.
- **confirm:** type `overwrite eddy-preview`.

It downloads the backup and checks its SHA-256 against the manifest. Then it decrypts it, restores it into **eddy-preview** and compares every table's row count with the manifest. The run fails on any difference, and prints table names and counts only.

It replaces the restored tables in eddy-preview. Restoring a production backup puts real club data into eddy-preview, which is as private as production (RLS on every table, service role only), so the drill is fine there. Still, restore production into preview only when you mean to.

A small difference on one busy table in a production backup can be real: row counts are taken just after the dump, so a write in the few seconds between them shows up. A clean backup of a quiet database matches exactly.

## Restoring production

For when eddy-production has lost data or is gone. **Decide first what the restore will overwrite:** anything written after the backup was made is lost.

1. **Stop writes:** switch the Worker to read-only (see [The read-only switch](#the-read-only-switch)). If hkha-sync might run during the restore, disable its workflow too. Tell coaches and officers that saving is off for a while.
2. **Pick the backup:** the newest `daily/eddy-production/...` before the problem, or a `monthly/` one.
3. **Restore.** The script the drill uses restores into whatever database it is pointed at. On a machine with the PostgreSQL client tools matching the server's major version, `age` and the AWS CLI:

   ```bash
   export PGURL='<eddy-production session pooler URI>'
   export OBJECT='daily/eddy-production/<date>.dump.age'
   export AGE_IDENTITY='<BACKUP_AGE_SECRET_KEY>'
   export R2_ACCOUNT_ID=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
   bash scripts/backup/restore.sh
   ```

   If the project itself is gone, create a new Supabase project in Singapore. Point `PGURL` at it and restore. Then update `DATA_SUPABASE_URL` and the Worker's `DATA_SUPABASE_SECRET_KEY` secret, and the sign-in project settings if sign-in moved too.
4. **Check** the row counts the script prints, then open the app and look at a few screens.
5. **Re-enable writes:** set `WRITES` back to `"on"`, then re-enable hkha-sync if you disabled it.

The restore leaves the `public` schema itself, its Supabase grants and default privileges alone, and replaces the objects in the backup. Tables created after the backup are not dropped.

## The read-only switch

`WRITES` is a var of the API Worker (`worker/src/readOnly.ts`). It is `"on"` in `worker/wrangler.toml`, for production and for preview. With `WRITES = "off"`:

- every save (any request other than GET, HEAD or the CORS preflight) gets `503` with the code `READ_ONLY`, before sign-in. The app shows one toast, "Eddy is read-only for a short while. Your change wasn't saved.", and the screen treats it as not saved;
- reads carry on, the `.ics` calendar feeds and signed file links included;
- the daily jobs (review emails, retention, the health check) do nothing but log a line, and the Worker's 5xx answers aren't written to `error_log`;
- `/health` answers `"writes": "off"`.

What it doesn't stop: sign-in still stamps `people.last_seen_at` once a day per person (`auth_context()`), and anything that writes to Postgres directly (hkha-sync, the backup heartbeat, the Table Editor) is outside the Worker.

**Switch it off, quickest:** Cloudflare dashboard, **Workers & Pages → hkfc-api → Settings → Variables and Secrets**, edit `WRITES` to `off` and deploy. It takes effect in seconds. The next `wrangler deploy` puts back the value in `wrangler.toml`, and CI deploys on every merge to `main`, so merge nothing while it's off. Switch it back the same way, to `on`.

**Or through the repo:** set `WRITES = "off"` under `[vars]` in `worker/wrangler.toml` and merge; CI deploys it. Switch back with another PR setting `"on"`. Slower (a full CI run each way), but it survives other deploys.

Check either way with `curl https://api.eddy.global/health`.

## Doing it by hand

Useful when GitHub is unavailable. With the tools above:

```bash
aws s3 cp --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com \
  s3://eddy-backups/daily/eddy-production/<date>.dump.age backup.age
age --decrypt --identity key.txt --output backup.dump backup.age   # key.txt holds the secret key
pg_restore --list backup.dump                                      # what is inside
```

Delete `key.txt` and `backup.dump` afterwards: the dump is readable club data.
