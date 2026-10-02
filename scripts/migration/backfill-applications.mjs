#!/usr/bin/env node
// After the final import: gives each new HKFC member whose application is
// part-way through signing in Fillout (stage 3, 4 or 5) an Eddy application
// row, so their signing carries on in Eddy (/sign-application). The import
// makes none: Fillout's submission isn't a record Eddy reads.
//
// What it carries across: the applicant's, spouse's and parent/guardian's
// imported signatures, and who had already signed by the stage (Page 7's
// signatures aren't imported, so a sponsor or Chairman who signed in Fillout
// shows as signed without their signature image). Stage 4 and 5 are best
// finished in Fillout before the freeze; this handles them if not.
//
//   node backfill-applications.mjs                                   dry run, eddy-preview
//   node backfill-applications.mjs --apply                           write eddy-preview
//   node backfill-applications.mjs --apply --target=production --i-understand-this-writes-production
//
// Idempotent: anyone who already has an application row is left alone.
// Prints stages and counts, never names. Eddy sends no email for these: tell
// the next signer (they also get a My Tasks line).

import { connect, parseArgs, targetDatabase } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2), { target: "preview" });
const apply = args.apply === true;
const target = targetDatabase(args);

const SIGNING = ["3. Club Application (Signed)", "4. Sponsor (Signed)", "5. Chairman (Signed)"];

const db = await connect(target.url);
try {
  const { rows } = await db.query(
    `select p.id, p.applicant_stage as stage, p.date_of_birth, p.bill_payer,
       (select f.id from public.files f where f.person_id = p.id and f.family_member_id is null and f.kind = 'signature' order by f.created_at desc limit 1) as signature,
       (select f.id from public.files f join public.family_members m on m.id = f.family_member_id
          where m.person_id = p.id and m.relation = 'spouse' and f.kind = 'signature' order by f.created_at desc limit 1) as spouse_signature,
       (select f.id from public.files f where f.person_id = p.id and f.kind = 'guardian_consent_signature' order by f.created_at desc limit 1) as guardian_signature,
       (select f.id from public.files f where f.person_id = p.id and f.kind = 'guardian_account_signature' order by f.created_at desc limit 1) as guardian_account_signature
     from public.people p
     where p.status = 'Applicant' and p.applicant_type = 'New HKFC Member' and p.applicant_stage = any($1)
       and not exists (select 1 from public.applications a where a.person_id = p.id)
     order by p.applicant_stage`,
    [SIGNING],
  );
  console.log(`${target.label}: ${rows.length} application(s) mid-signing with no Eddy record`);
  for (const r of rows) {
    const stage = SIGNING.indexOf(r.stage) + 3;
    console.log(`  stage ${stage}: applicant signature ${r.signature ? "yes" : "MISSING"}, spouse ${r.spouse_signature ? "yes" : "-"}, guardian ${r.guardian_signature ? "yes" : "-"}`);
  }
  if (!apply) {
    console.log("Dry run: add --apply to write.");
  } else if (rows.length) {
    await db.query("begin");
    for (const r of rows) {
      const stage = SIGNING.indexOf(r.stage) + 3;
      await db.query(
        `insert into public.applications (person_id, application_type, wording_version, accepted,
           signature_file_id, spouse_signature_file_id, guardian_signature_file_id, guardian_account_signature_file_id,
           sponsor_signed_at, chair_signed_at)
         values ($1, 'New HKFC Member', 'fillout', '{}', $2, $3, $4, $5,
           case when $6 >= 4 then now() end, case when $6 >= 5 then now() end)`,
        [r.id, r.signature, r.spouse_signature, r.guardian_signature, r.guardian_account_signature, stage],
      );
    }
    await db.query("commit");
    console.log(`Wrote ${rows.length}. Tell each one's next signer: it's in their My Tasks (no email is sent).`);
  }
} catch (err) {
  await db.query("rollback").catch(() => undefined);
  throw err;
} finally {
  await db.end();
}
