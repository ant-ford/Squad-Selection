/**
 * The Section / DSA Player Statement: filled once the Membership Officer
 * completes a commitment review, kept on the commitment (files kind
 * 'player_statement', like the ones imported from Airtable), and emailed
 * to that Membership Officer, as the Make route did ("Player Statement
 * (Complete)").
 *
 * The template is a fillable form; the two signatures go beside each
 * signer's Name / Designation / Date row, the only free space on it.
 * "For Interview in" and "TP No." are for the club's office and stay blank
 * (owner, 1 Oct 2026).
 */
import type { Env } from "../env";
import type { RenderSpec } from "./render";
import { documentFilename, fileAsset, renderPdf, storeDocument, templateAsset, type Asset } from "./render";
import { db, eq, inList } from "../data/supabase";
import { fileLink } from "../data/supabase/files";
import { sendEmail } from "../mailer";
import { PDF_TEMPLATES } from "./templates";
import { PRACTICES } from "../../../shared/commitmentReview";

export interface Signer {
  name: string;
  designation: string;
  /** yyyy-mm-dd or an ISO timestamp. */
  date: string | null;
  signed: boolean;
}

export interface PlayerStatementFacts {
  candidateName: string;
  joinDate: string | null;
  teamsPlayed: string[];
  currentTeam: string | null;
  position: string | null;
  matchesPlayed: number | null;
  matchesTeamPlayed: number | null;
  matchesNotAvailable: number | null;
  practices: string;
  socialFunctions: string[];
  sectionService: string;
  hkfcService: string;
  recommendation: string;
  playersAvailable: number | null;
  optimumPlayers: number | null;
  isPlayerNeeded: string;
  otherComments: string;
  recommendedReduction: string;
  sponsor: Signer;
  officer: Signer;
}

/** dd/mm/yyyy, the club's way of writing a date. */
export function ddmmyyyy(value: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

const count = (n: number | null) => (n === null || n === undefined ? "" : String(n));

/** The fields and signatures, from the review. Pure, so the mapping is tested without a render. */
export function playerStatementSpec(f: PlayerStatementFacts): RenderSpec {
  // Available but not picked: the team's matches less those played and those missed.
  const dnp = f.matchesTeamPlayed !== null && f.matchesPlayed !== null
    ? Math.max(0, f.matchesTeamPlayed - f.matchesPlayed - (f.matchesNotAvailable ?? 0))
    : null;
  const committeeReason = [f.isPlayerNeeded, f.otherComments].map((s) => s.trim()).filter(Boolean).join("\n\n");
  const fields: Record<string, string | boolean> = {
    date_joined: ddmmyyyy(f.joinDate),
    candidate_name: f.candidateName,
    sec_hockey: true,
    teams_played: f.teamsPlayed.join(", "),
    current_team: f.currentTeam ?? "",
    position: f.position ?? "",
    not_available: count(f.matchesNotAvailable),
    games_available_dnp: count(dnp),
    available_and_played: count(f.matchesPlayed),
    training_very_regular: f.practices === PRACTICES[0],
    training_moderate: f.practices === PRACTICES[1],
    training_hardly_ever: f.practices === PRACTICES[2],
    social_functions: f.socialFunctions.length ? f.socialFunctions.join(", ") : "None",
    potential_section: f.sectionService,
    potential_hkfc: f.hkfcService,
    year_commitment_reduction: f.recommendedReduction,
    recommendation_reason: f.recommendation,
    current_available_players: count(f.playersAvailable),
    recommender_name: f.sponsor.name,
    recommender_designation: f.sponsor.designation,
    recommender_date: ddmmyyyy(f.sponsor.date),
    committee_reason: committeeReason,
    optimum_players: count(f.optimumPlayers),
    committee_name: f.officer.name,
    committee_designation: f.officer.designation,
    committee_date: ddmmyyyy(f.officer.date),
  };
  const images = [
    // Right of each Date box (x 420-485), on the same row.
    ...(f.sponsor.signed ? [{ page: 1, x: 490, y: 166, width: 74, height: 28, asset: "sponsor-signature" }] : []),
    ...(f.officer.signed ? [{ page: 1, x: 490, y: 24, width: 74, height: 28, asset: "officer-signature" }] : []),
  ];
  return {
    title: `${PDF_TEMPLATES["player-statement"].title}: ${f.candidateName}`,
    parts: [{ kind: "template", asset: "template", fields, images }],
  };
}

// ── Making it ───────────────────────────────────────────────────────────

interface StatementRow {
  id: string;
  person_id: string;
  year_no: number | null;
  sponsor_office_id: string | null;
  membership_officer_office_id: string | null;
  sponsor_submitted_at: string | null;
  officer_submitted_at: string | null;
  officer_signature_file_id: string | null;
}

interface ReviewViewRow {
  full_name: string | null;
  preferred_name: string | null;
  team: string | null;
  playing_position: string | null;
  matches_played: number | null;
  matches_team_played: number | null;
  matches_not_available: number | null;
  teams_played: string[] | null;
  practices: string | null;
  social_functions: string[] | null;
  section_service_member: string | null;
  hkfc_service_member: string | null;
  section_service_sponsor: string | null;
  hkfc_service_sponsor: string | null;
  recommendation_sponsor: string | null;
  players_available_for_team: number | null;
  optimum_players_for_team: number | null;
  is_player_needed_officer: string | null;
  other_comments_officer: string | null;
  recommended_reduction: string | null;
  sponsor_signature_file: string | null;
}

interface OfficeRow {
  id: string;
  designation: string | null;
  office_email: string | null;
  people: { id: string; preferred_name: string | null; given_names: string | null; surname: string | null; email: string | null } | null;
}

const nameOf = (p: OfficeRow["people"]) => [p?.preferred_name || p?.given_names, p?.surname].filter(Boolean).join(" ");

const appOrigin = (env: Env) => (env.APP_ORIGIN ?? "https://app.eddy.global").replace(/\/+$/, "");

/**
 * Fills, keeps and sends the Player Statement for a completed review.
 * Returns the files id, or null when the review is not complete.
 */
export async function makePlayerStatement(env: Env, reviewApiId: string): Promise<string | null> {
  const d = db(env);
  const c = await d.one<StatementRow>(
    "commitments",
    `select=id,person_id,year_no,sponsor_office_id,membership_officer_office_id,sponsor_submitted_at,officer_submitted_at,officer_signature_file_id&api_id=${eq(reviewApiId)}`,
  );
  if (!c?.officer_submitted_at) return null;
  const [r, person, offices] = await Promise.all([
    d.one<ReviewViewRow>("api_reviews", `select=*&id=${eq(reviewApiId)}`),
    d.one<{ join_date: string | null }>("people", `select=join_date&id=${eq(c.person_id)}`),
    d.select<OfficeRow>(
      "offices",
      `select=id,designation,office_email,people!offices_person_id_fkey(id,preferred_name,given_names,surname,email)&id=${inList([c.sponsor_office_id, c.membership_officer_office_id].filter((x): x is string => !!x))}`,
    ),
  ]);
  if (!r) return null;
  const sponsorOffice = offices.find((o) => o.id === c.sponsor_office_id);
  const officerOffice = offices.find((o) => o.id === c.membership_officer_office_id);

  const facts: PlayerStatementFacts = {
    candidateName: r.full_name ?? r.preferred_name ?? "",
    joinDate: person?.join_date ?? null,
    teamsPlayed: r.teams_played ?? [],
    currentTeam: r.team,
    position: r.playing_position,
    matchesPlayed: r.matches_played,
    matchesTeamPlayed: r.matches_team_played,
    matchesNotAvailable: r.matches_not_available,
    practices: r.practices ?? "",
    socialFunctions: r.social_functions ?? [],
    sectionService: r.section_service_sponsor || r.section_service_member || "",
    hkfcService: r.hkfc_service_sponsor || r.hkfc_service_member || "",
    recommendation: r.recommendation_sponsor ?? "",
    playersAvailable: r.players_available_for_team,
    optimumPlayers: r.optimum_players_for_team,
    isPlayerNeeded: r.is_player_needed_officer ?? "",
    otherComments: r.other_comments_officer ?? "",
    recommendedReduction: r.recommended_reduction ?? "",
    sponsor: { name: nameOf(sponsorOffice?.people ?? null), designation: sponsorOffice?.designation ?? "Sponsor", date: c.sponsor_submitted_at, signed: !!r.sponsor_signature_file },
    officer: { name: nameOf(officerOffice?.people ?? null), designation: officerOffice?.designation ?? "Membership Officer", date: c.officer_submitted_at, signed: !!c.officer_signature_file_id },
  };

  const assets: Record<string, Asset> = { template: await templateAsset(env, "player-statement") };
  if (r.sponsor_signature_file) assets["sponsor-signature"] = await fileAsset(env, r.sponsor_signature_file);
  if (c.officer_signature_file_id) assets["officer-signature"] = await fileAsset(env, c.officer_signature_file_id);

  const rendered = await renderPdf(env, playerStatementSpec(facts), assets);
  if (rendered.warnings.length) console.warn(`Player Statement ${reviewApiId}: ${rendered.warnings.join("; ")}`);
  const filename = documentFilename(`Player Statement${c.year_no ? ` Year ${c.year_no}` : ""}`, facts.candidateName);
  const fileId = await storeDocument(env, rendered.pdf, { kind: "player_statement", filename, personId: c.person_id, commitmentId: c.id });

  const to = officerOffice?.office_email || officerOffice?.people?.email;
  if (to && officerOffice?.people) {
    await sendEmail(env, {
      toPersonId: officerOffice.people.id,
      to,
      subject: `Player Statement (Complete): ${facts.candidateName}`,
      text: [
        `Hi ${officerOffice.people.preferred_name || officerOffice.people.given_names || "there"},`,
        "",
        `${facts.candidateName}'s ${c.year_no ? `Year ${c.year_no} ` : ""}Player Statement is complete. The signed statement is attached, and it is also in Eddy:`,
        `${appOrigin(env)}/review/${reviewApiId}`,
        "",
        "HKFC Hockey Section",
      ].join("\n"),
      template: "player-statement-complete",
      from: env.REVIEW_EMAIL_FROM || undefined,
      attachments: [{ filename, path: await fileLink(env, fileId) }],
    });
  }
  return fileId;
}
