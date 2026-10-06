# Season rollover: the July checklist

Once a year, in July, after the season has ended and before the new season's
teams are picked. Eddy's "current season" turns over on 1 July (Hong Kong time).

## Happens by itself on 1 July

- **My Tasks** asks every Active member to check their details and sign the
  waivers again: anything done before 1 July counts as last season.
- **HKHA registration** starts an empty list for the new season. Players with a
  previous EOS team show as returning; players without one show as new.
- **Season plans** start empty, and stats, attendance and the umpiring report
  move to the new season. Last season's figures stay under its own label.
- **Fixtures** arrive through hkha-sync once HockeyHK publishes them.

## Roll the teams over (Supabase SQL editor, eddy-production)

1. Check that last night's backup succeeded (the `backup` workflow in GitHub
   Actions).
2. Run a dry run. It changes nothing:

   ```sql
   select * from public.season_rollover();
   ```

   - `summary`: how many Active people there are, how many will change, and
     how many haven't been seen in Eddy since 1 January.
   - `team`: one row per person. It shows the team they finished in, their
     previous EOS and SOS changes, and "EOS cleared".
   - `not seen`: Active players who haven't opened Eddy since 1 January.
3. Apply it:

   ```sql
   select * from public.season_rollover(p_apply => true);
   ```

   For every **Active** person:
   - **previous EOS** becomes the team they finished in (EOS, else SOS, else
     the registered team);
   - **Selected Team EOS** is cleared;
   - **Selected Team SOS** is set to that same team, as a starting point.

   Inactive people aren't changed. A season can only be rolled over once.
4. If it went wrong, undo it straight away. Undo puts the three team fields
   back as they were and overwrites any team changes made since:

   ```sql
   select public.season_rollover_undo('2027-2028');
   ```

## Afterwards

- **Section Captains** change Selected Team SOS for anyone moving team. There's
  no Eddy screen for this yet, so use the Supabase Table Editor
  (`people.selected_team_sos`).
- **Captains** contact the players on the `not seen` list. Anyone who has
  stopped playing sets "Active: No" in My Details, or an officer does it for
  them.
- **Kit Convenor** loads the new kit order once it's placed
  (`import-kit-order.mjs`, dry run first).

`not seen` relies on `people.last_seen_at`, which Eddy stamps when someone uses
the app. Until that stamping has run since January, everyone shows as "never
seen".
