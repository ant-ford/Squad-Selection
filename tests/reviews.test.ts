import { signedIn } from "./helpers/factories";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import {
  getReview,
  memberReportFrom,
  officerReviewFrom,
  rolesFor,
  signatureBytes,
  sponsorReviewFrom,
  stepFor,
  submitMemberReport,
  submitSponsorReview,
} from "../worker/src/reviews";
import { belowAttendance } from "../shared/commitmentReview";

const env = {
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  CALENDAR_SECRET: "test",
  API_ORIGIN: "https://api.test",
  APP_ORIGIN: "https://app.test",
  RESEND_API_KEY: "re_test",
  MAIL_FROM: "Eddy <notifications@eddy.global>",
} as Env;

const user = (personId: string, officer = false, sectionCaptain = false): AuthorizedUser => (signedIn({
  email: `${personId}@x.com`,
  personId,
  role: "player",
  coachTeams: [],
  isSectionCaptain: false,
  officerRoles: [
    ...(officer ? [{ office: "membershipOfficer" as const, designation: "Membership Officer" }] : []),
    ...(sectionCaptain ? [{ office: "sectionCaptain" as const, designation: "Men's Captain" }] : []),
  ],
}));

const REVIEW = "recAAAAAAAAAAAAAA";
const row = (over: Record<string, unknown> = {}) => ({
  id: REVIEW, stage: "Notified Member", person: "recMEMBER00000000", preferred_name: "Sam", full_name: "Sam Smith",
  membership_no: "123", year_no: 2, period_start: "2025-10-01", period_end: "2026-09-30", team: "HKFC D",
  playing_position: "Defender", qualified_umpire: null, matches_played: 12, matches_team_played: 18,
  matches_not_available: 3, teams_played: ["HKFC D"], sponsor_office: "recSPONSOROFFICE0", sponsor_person: "recSPONSOR0000000",
  sponsor_name: "Pat", officer_office: null, officer_person: null, officer_name: null, usual_sponsor_office: "recSPONSOROFFICE0",
  games_umpired: "2", practices: "Moderate 50-70%", social_functions: ["End of Season"], other_contributions: "Kit",
  section_service_member: "a", hkfc_service_member: "b", low_participation_reason: null, member_submitted_at: null,
  section_service_sponsor: "sponsor-secret", hkfc_service_sponsor: "x", recommendation_sponsor: "y", sponsor_submitted_at: null,
  players_available_for_team: 16, optimum_players_for_team: 14, is_player_needed_officer: "officer-secret",
  other_comments_officer: null, other_information_officer: null, recommended_reduction: "None", officer_submitted_at: null,
  sponsor_signature_file: null, officer_signature_file: null,
  ...over,
});

type Call = { url: URL; method: string; body: any };
function fake(reviewRow: object | null, opts: { next?: object[]; rpcError?: { code: string; message: string }; mailbox?: string } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.host === "api.resend.com") return reply({ id: "re_1" });
    if (url.pathname.endsWith("/rpc/emails_sent_today")) return reply(0);
    if (url.pathname.includes("/rpc/submit_")) return opts.rpcError ? reply(opts.rpcError, 400) : reply(opts.next ?? []);
    if (url.pathname.endsWith("/api_reviews")) return reply(reviewRow ? [reviewRow] : []);
    if (url.pathname.endsWith("/commitments")) return reply(opts.mailbox ? [{ office: { office_email: opts.mailbox } }] : []);
    if (/\/api_players(_lite)?$/.test(url.pathname)) {
      // Two with HKFC D as their Selected Team (one registered elsewhere), one selected for C.
      return reply([
        { id: "recP1", registered_team: "HKFC D", selected_team_sos: null, selected_team_eos: null, active: true },
        { id: "recP2", registered_team: "HKFC E", selected_team_sos: "HKFC D", selected_team_eos: null, active: true },
        { id: "recP3", registered_team: "HKFC D", selected_team_sos: null, selected_team_eos: "HKFC C", active: true },
      ]);
    }
    if (url.pathname.endsWith("/api_review_offices")) {
      return reply([{ id: "recSPONSOROFFICE0", role: "sponsor", preferred_name: "Pat", surname: "Lee", designation: null },
        { id: "recMOOFFICE000000", role: "membership_officer", preferred_name: "Mo", surname: "Wong", designation: "Membership Officer" }]);
    }
    return reply([]);
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("who sees and does what", () => {
  it("gives each person their roles, and the step only to whose turn it is", () => {
    const r = row();
    expect(rolesFor(user("recMEMBER00000000"), r)).toEqual(["member"]);
    expect(rolesFor(user("recSPONSOR0000000"), r)).toEqual(["sponsor"]);
    expect(rolesFor(user("recSOMEONE0000000", true), r)).toEqual(["officer"]);
    expect(rolesFor(user("recSOMEONE0000000", false, true), r)).toEqual(["viewer"]);
    expect(rolesFor(user("recSOMEONE0000000"), r)).toEqual([]);
    expect(stepFor("Notified Member", ["member"])).toBe("member");
    expect(stepFor("Notified Member", ["sponsor"])).toBeNull();
    expect(stepFor("Member Submitted (with Sponsor)", ["sponsor"])).toBe("sponsor");
    expect(stepFor("Sponsor Submitted (with Membership Officer)", ["officer"])).toBe("officer");
    expect(stepFor("Complete", ["officer"])).toBeNull();
  });

  it("never shows the member the sponsor's or officer's review", async () => {
    fake(row({ stage: "Complete", member_submitted_at: "2026-09-01T00:00:00.000Z", sponsor_submitted_at: "2026-09-02T00:00:00.000Z", officer_submitted_at: "2026-09-03T00:00:00.000Z" }));
    const v = await getReview(env, user("recMEMBER00000000"), REVIEW);
    expect(v.report?.practices).toBe("Moderate 50-70%");
    expect(v.sponsorReview).toBeNull();
    expect(v.officerReview).toBeNull();
    expect(JSON.stringify(v)).not.toMatch(/sponsor-secret|officer-secret/);
  });

  it("shows the sponsor the member's report and their own review, not the officer's", async () => {
    fake(row({ stage: "Complete", member_submitted_at: "2026-09-01T00:00:00.000Z", sponsor_submitted_at: "2026-09-02T00:00:00.000Z", officer_submitted_at: "2026-09-03T00:00:00.000Z" }));
    const v = await getReview(env, user("recSPONSOR0000000"), REVIEW);
    expect(v.report).not.toBeNull();
    expect(v.sponsorReview?.sectionService).toBe("sponsor-secret");
    expect(v.officerReview).toBeNull();
  });

  it("offers the member their usual sponsor and the Membership Officers when it is their turn", async () => {
    fake(row());
    const v = await getReview(env, user("recMEMBER00000000"), REVIEW);
    expect(v.canDo).toBe("member");
    expect(v.options?.usualSponsor).toBe("recSPONSOROFFICE0");
    expect(v.options?.officers.map((o) => o.name)).toEqual(["Mo Wong"]);
  });

  it("gives the Membership Officer the team's active players, counted by Selected Team", async () => {
    fake(row({ stage: "Sponsor Submitted (with Membership Officer)", member_submitted_at: "x", sponsor_submitted_at: "y" }));
    const v = await getReview(env, user("recSOMEONE0000000", true), REVIEW);
    expect(v.canDo).toBe("officer");
    expect(v.teamActivePlayers).toBe(2);
    fake(row({ stage: "Member Submitted (with Sponsor)", member_submitted_at: "x" }));
    expect((await getReview(env, user("recSPONSOR0000000"), REVIEW)).teamActivePlayers).toBeUndefined();
  });

  it("refuses anyone with no part in the review, and an unknown id", async () => {
    fake(row());
    await expect(getReview(env, user("recSOMEONE0000000"), REVIEW)).rejects.toMatchObject({ status: 403 });
    await expect(getReview(env, user("recMEMBER00000000"), "not-an-id")).rejects.toMatchObject({ status: 400 });
    fake(null);
    await expect(getReview(env, user("recMEMBER00000000"), "0b9c5b53-9c1a-4b6e-8f53-9a3c2b1d0e4f")).rejects.toMatchObject({ status: 404 });
  });
});

describe("answers", () => {
  const good = { gamesUmpired: "2", practices: "Moderate 50-70%", socialFunctions: ["End of Season"], sponsor: "recSPONSOROFFICE0" };

  it("checks the member's choices against the form's own lists", () => {
    expect(memberReportFrom(good)).toMatchObject({ gamesUmpired: "2", socialFunctions: ["End of Season"] });
    expect(() => memberReportFrom({ ...good, gamesUmpired: "7" })).toThrow(/umpired/);
    expect(() => memberReportFrom({ ...good, practices: "Always" })).toThrow(/practice/);
    // Choosing none is saying none; there is no "None" option any more.
    expect(memberReportFrom({ ...good, socialFunctions: [] }).socialFunctions).toEqual([]);
    expect(() => memberReportFrom({ ...good, socialFunctions: ["None"] })).toThrow(/social function/);
    expect(() => memberReportFrom({ ...good, sponsor: "" })).toThrow(/sponsor/);
  });

  it("asks for a reason only under the commitment's 70% match attendance", () => {
    expect(belowAttendance(18, 22)).toBe(false); // 82%
    expect(belowAttendance(14, 20)).toBe(false); // exactly 70%
    expect(belowAttendance(13, 20)).toBe(true); // 65%
    expect(belowAttendance(0, 0)).toBe(true); // cannot tell: ask
    expect(belowAttendance(null, 20)).toBe(true);
  });

  it("needs all three sponsor answers, and the officer's numbers and reduction", () => {
    expect(() => sponsorReviewFrom({ sectionService: "a", hkfcService: "b" })).toThrow(/three/);
    const officer = { playersAvailable: "16", optimumPlayers: "14", isPlayerNeeded: "Yes", recommendedReduction: "1 year" };
    expect(officerReviewFrom(officer)).toMatchObject({ recommendedReduction: "1 year" });
    expect(() => officerReviewFrom({ ...officer, playersAvailable: "lots" })).toThrow(/players available/);
    expect(() => officerReviewFrom({ ...officer, recommendedReduction: "3 years" })).toThrow(/reduction/);
  });

  it("accepts only a small PNG as a signature", () => {
    const png = "data:image/png;base64," + btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3));
    expect(signatureBytes(png).length).toBe(11);
    expect(() => signatureBytes("data:image/jpeg;base64,AAAA")).toThrow(/PNG/);
    expect(() => signatureBytes("data:image/png;base64," + btoa("not a png"))).toThrow(/PNG/);
  });
});

describe("submitting", () => {
  const report = { gamesUmpired: "2", practices: "Moderate 50-70%", socialFunctions: ["End of Season"], sponsor: "recSPONSOROFFICE0" };

  it("hands the member's report to the database as the member, then emails the sponsor a link", async () => {
    const calls = fake(row(), { next: [{ step_id: "s1", commitment_id: "c1", person_id: "p-sponsor", email: "pat@x.com", preferred_name: "Pat", member_name: "Sam Smith", year_no: 2 }] });
    const result = await submitMemberReport(env, user("recMEMBER00000000"), REVIEW, report);
    expect(result).toEqual({ ok: true, emailed: true });
    const rpc = calls.find((c) => c.url.pathname.endsWith("/rpc/submit_member_report"))!;
    expect(rpc.body).toMatchObject({ p_commitment: REVIEW, p_actor: "recMEMBER00000000", p: { sponsor: "recSPONSOROFFICE0" } });
    const email = calls.find((c) => c.url.host === "api.resend.com")!;
    expect(email.body.to).toEqual(["pat@x.com"]);
    expect(email.body.text).toContain(`https://app.test/review/${REVIEW}`);
  });

  it("writes to the office's own mailbox when it has one", async () => {
    const next = [{ step_id: "s1", commitment_id: "c1", person_id: "p-sponsor", email: "pat@x.com", preferred_name: "Pat", member_name: "Sam Smith", year_no: 2 }];
    const calls = fake(row(), { next, mailbox: "office@hkfchockey.com" });
    await submitMemberReport(env, user("recMEMBER00000000"), REVIEW, report);
    expect(calls.find((c) => c.url.host === "api.resend.com")!.body.to).toEqual(["office@hkfchockey.com"]);
    const lookup = calls.find((c) => c.url.pathname.endsWith("/commitments"))!;
    expect(lookup.url.searchParams.get("select")).toBe("office:offices!commitments_sponsor_office_id_fkey(office_email)");
    expect(lookup.url.searchParams.get("id")).toBe("eq.c1");
  });

  it("turns the database's refusals into clear answers", async () => {
    fake(row(), { rpcError: { code: "55000", message: 'This review is at "Complete"' } });
    await expect(submitMemberReport(env, user("recMEMBER00000000"), REVIEW, report)).rejects.toMatchObject({ status: 409, code: "WRONG_STEP" });
    fake(row(), { rpcError: { code: "42501", message: "Only the member can submit their Player Statement" } });
    await expect(submitMemberReport(env, user("recMEMBER00000000"), REVIEW, report)).rejects.toMatchObject({ status: 403 });
  });

  it("will not store a signature for someone who is not the sponsor", async () => {
    const calls = fake(row({ stage: "Member Submitted (with Sponsor)" }));
    await expect(
      submitSponsorReview(env, user("recSOMEONE0000000"), REVIEW, { sectionService: "a", hkfcService: "b", recommendation: "c", signature: "data:image/png;base64,iVBORw0KGgo=" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls.some((c) => c.url.pathname.endsWith("/files") && c.method === "POST")).toBe(false);
  });
});
