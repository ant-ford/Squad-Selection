/**
 * HockeyHK's Player Registration Form for players under 18: filled when a
 * parent or guardian signs the waivers (declarations.ts), kept on the
 * player (files kind 'u18_registration_form', like the imported ones), and
 * emailed to the Hockey Convenor, who sends it on to HockeyHK (owner,
 * 1 Oct 2026).
 *
 * The template is a flat page, so the text goes at measured positions:
 * the answer column of the Section 1 table (x 354-521) and the blanks in
 * the English and Chinese consent and the signature block.
 */
import type { Env } from "../env";
import type { RenderSpec } from "./render";
import { documentFilename, fileAsset, renderPdf, storeDocument, templateAsset } from "./render";
import { db, eq } from "../data/supabase";
import { fileLink } from "../data/supabase/files";
import { sendEmail } from "../mailer";
import { PDF_TEMPLATES } from "./templates";
import { ddmmyyyy } from "./playerStatement";

export const CLUB_NAME = "Hong Kong Football Club";

export interface U18Facts {
  surname: string;
  givenNames: string;
  /** HKID, or the passport number without one. */
  idNumber: string;
  dateOfBirth: string | null;
  nationality: string;
  mobileNo: string;
  email: string;
  team: string;
  jerseyNo: number | null;
  guardianSurname: string;
  guardianGivenNames: string;
  guardianMobileNo: string;
  guardianEmail: string;
  /** When the guardian signed (ISO). */
  signedAt: string;
}

/** Baselines of the 14 rows of the Section 1 table, top to bottom. */
const ROW_Y = [611.8, 598.3, 578.3, 557.8, 544.5, 531.0, 517.8, 504.3, 490.8, 477.3, 463.8, 450.3, 437.3, 423.8];
const COLUMN_X = 357;
const COLUMN_WIDTH = 161;

export function u18Spec(f: U18Facts): RenderSpec {
  const guardian = [f.guardianGivenNames, f.guardianSurname].filter(Boolean).join(" ");
  const rows = [
    f.surname,
    f.givenNames,
    f.idNumber,
    ddmmyyyy(f.dateOfBirth),
    f.nationality,
    f.mobileNo,
    f.email,
    [CLUB_NAME, f.team].filter(Boolean).join(" - "),
    "",
    f.jerseyNo === null ? "" : String(f.jerseyNo),
    f.guardianSurname,
    f.guardianGivenNames,
    f.guardianMobileNo,
    f.guardianEmail,
  ];
  return {
    title: `${PDF_TEMPLATES["u18-registration"].title}: ${[f.givenNames, f.surname].filter(Boolean).join(" ")}`,
    parts: [{
      kind: "template",
      asset: "template",
      text: [
        ...rows.map((text, i) => ({ page: 1, x: COLUMN_X, y: ROW_Y[i], text, maxWidth: COLUMN_WIDTH })).filter((t) => t.text),
        // Section 2: "By signing below, I, ____" and "for ____ (the Club)".
        { page: 1, x: 175, y: 366.5, text: guardian, maxWidth: 107 },
        { page: 1, x: 166, y: 301.5, text: CLUB_NAME, maxWidth: 116 },
        // The Chinese consent's same two blanks.
        { page: 2, x: 150, y: 593.5, text: guardian, maxWidth: 143 },
        { page: 2, x: 339, y: 509, text: CLUB_NAME, maxWidth: 98 },
        // Name and date under the signature.
        { page: 2, x: 184, y: 76, text: guardian, maxWidth: 138 },
        { page: 2, x: 184, y: 52, text: ddmmyyyy(f.signedAt) },
      ],
      images: [{ page: 2, x: 183, y: 99, width: 138, height: 30, asset: "guardian-signature" }],
    }],
  };
}

// ── Making it ───────────────────────────────────────────────────────────

interface PlayerRow {
  id: string;
  surname: string | null;
  given_names: string | null;
  preferred_name: string | null;
  hkid_no: string | null;
  passport_no: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  mobile_no: string | null;
  email: string | null;
  registered_team: string | null;
  selected_team_sos: string | null;
  shirt_number_id: string | null;
  sponsored_by_hockey_convenor_id: string | null;
}

interface ConvenorRow {
  id: string;
  office_email: string | null;
  people: { id: string; preferred_name: string | null; given_names: string | null; email: string | null } | null;
}

const appOrigin = (env: Env) => (env.APP_ORIGIN ?? "https://app.eddy.global").replace(/\/+$/, "");

/**
 * Fills, keeps and sends the form for the declaration just signed (the
 * latest one with a guardian signature). Returns the files id, or null when
 * there is no guardian's signing to fill it from.
 */
export async function makeU18Registration(env: Env, personUuid: string): Promise<string | null> {
  const d = db(env);
  const [p, signing] = await Promise.all([
    d.one<PlayerRow>(
      "people",
      `select=id,surname,given_names,preferred_name,hkid_no,passport_no,date_of_birth,nationality,mobile_no,email,registered_team,selected_team_sos,shirt_number_id,sponsored_by_hockey_convenor_id&id=${eq(personUuid)}`,
    ),
    d.one<{ signed_at: string; guardian_surname: string | null; guardian_given_names: string | null; guardian_mobile_no: string | null; guardian_email: string | null; guardian_signature_file_id: string | null }>(
      "declarations",
      `select=signed_at,guardian_surname,guardian_given_names,guardian_mobile_no,guardian_email,guardian_signature_file_id&person_id=${eq(personUuid)}&guardian_signature_file_id=not.is.null&order=signed_at.desc&limit=1`,
    ),
  ]);
  if (!p || !signing?.guardian_signature_file_id) return null;
  const shirt = p.shirt_number_id ? await d.one<{ shirt_no: number }>("shirt_numbers", `select=shirt_no&id=${eq(p.shirt_number_id)}`) : null;

  const facts: U18Facts = {
    surname: p.surname ?? "",
    givenNames: p.given_names ?? p.preferred_name ?? "",
    idNumber: p.hkid_no || p.passport_no || "",
    dateOfBirth: p.date_of_birth,
    nationality: p.nationality ?? "",
    mobileNo: p.mobile_no ?? "",
    email: p.email ?? "",
    team: p.registered_team || p.selected_team_sos || "",
    jerseyNo: shirt?.shirt_no ?? null,
    guardianSurname: signing.guardian_surname ?? "",
    guardianGivenNames: signing.guardian_given_names ?? "",
    guardianMobileNo: signing.guardian_mobile_no ?? "",
    guardianEmail: signing.guardian_email ?? "",
    signedAt: signing.signed_at,
  };

  const rendered = await renderPdf(env, u18Spec(facts), {
    template: await templateAsset(env, "u18-registration"),
    "guardian-signature": await fileAsset(env, signing.guardian_signature_file_id),
  });
  if (rendered.warnings.length) console.warn(`U18 form ${personUuid}: ${rendered.warnings.join("; ")}`);
  const playerName = [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ");
  const filename = documentFilename("HockeyHK U18 Registration", playerName);
  const fileId = await storeDocument(env, rendered.pdf, { kind: "u18_registration_form", filename, personId: p.id });

  // The player's own Hockey Convenor, else the first active one.
  const convenors = await d.select<ConvenorRow>(
    "offices",
    "select=id,office_email,people!offices_person_id_fkey(id,preferred_name,given_names,email)&role=eq.hockey_convenor&status=eq.Active&order=created_at",
  );
  const convenor = convenors.find((o) => o.id === p.sponsored_by_hockey_convenor_id) ?? convenors.find((o) => o.people);
  const to = convenor?.office_email || convenor?.people?.email;
  if (!convenor?.people || !to) {
    console.warn(`U18 form ${personUuid}: kept, but no active Hockey Convenor with an email to send it to`);
    return fileId;
  }
  await sendEmail(env, {
    toPersonId: convenor.people.id,
    to,
    subject: `HockeyHK U18 registration form: ${playerName}`,
    text: [
      `Hi ${convenor.people.preferred_name || convenor.people.given_names || "there"},`,
      "",
      `${playerName}'s parent or guardian has signed HockeyHK's Player Registration Form for players under 18. It is attached, ready to send on to HockeyHK.`,
      "",
      `It is also kept on ${playerName}'s record in Eddy: ${appOrigin(env)}`,
      "",
      "HKFC Hockey Section",
    ].join("\n"),
    template: "u18-registration-form",
    attachments: [{ filename, path: await fileLink(env, fileId) }],
  });
  return fileId;
}
