import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { completeJoinerTask, createJoiner, inviteJoiner, parseJoinerForm, requestKit } from "../worker/src/joiners";
import { invitationEmail, kitEmail, registrationEmail } from "../worker/src/joinerEmails";
import { EMPTY_JOINER, joinerProblem, type JoinerForm } from "../shared/joiners";

const env = {
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  RESEND_API_KEY: "re_test",
  MAIL_FROM: "Eddy <notifications@eddy.global>",
  APP_ORIGIN: "https://app.eddy.global",
  REVIEW_EMAIL_FROM: "Anthony Ford <menscaptain@hkfchockey.com>",
} as Env;

const captain = { email: "ant@x.com", personId: "recCAPTAIN00000001", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [{ office: "sectionCaptain", designation: "Men's Captain" }] } as unknown as AuthorizedUser;
const player = { ...captain, officerRoles: [] } as AuthorizedUser;

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const person = (id: number, apiId: string, preferred: string, surname: string, email: string | null) => ({ id: U(id), api_id: apiId, preferred_name: preferred, given_names: null, surname, email });
const OFFICES = [
  { id: U(101), role: "sponsor", designation: "Team Captain", office_email: null, person_id: U(1), people: person(1, "recSPONSOR", "Chris", "Jones", "chris@x.com") },
  { id: U(102), role: "membership_officer", designation: "Men's Membership Officer", office_email: "mensmembership@hkfchockey.com", person_id: U(2), people: person(2, "recMO", "Daniel", "Cai", "dan@x.com") },
  { id: U(103), role: "section_chair", designation: "Chairman", office_email: "chair@hkfchockey.com", person_id: U(3), people: person(3, "recCHAIR", "Paul", "Chan", "paul@x.com") },
  { id: U(104), role: "section_captain", designation: "Men's Captain", office_email: "menscaptain@hkfchockey.com", person_id: U(4), people: person(4, "recCAPTAIN00000001", "Ant", "Ford", "ant@x.com") },
  { id: U(105), role: "section_captain", designation: "Men's Vice Captain", office_email: "mensvicecaptain@hkfchockey.com", person_id: U(5), people: person(5, "recVC1", "Gwen", "Laot", "g@x.com") },
  { id: U(106), role: "section_captain", designation: "Men's Vice Captain", office_email: "mensvicecaptain@hkfchockey.com", person_id: U(6), people: person(6, "recVC2", "Ralph", "Giulianotti", "r@x.com") },
  { id: U(107), role: "kit_convenor", designation: "Men's Kit Convenor", office_email: "kit@x.com", person_id: U(7), people: person(7, "recKIT", "Dil", "Gill", "dil@x.com") },
];

const form: JoinerForm = {
  ...EMPTY_JOINER,
  applicantType: "New HKFC Member",
  email: "Sam.Lee@Example.com",
  preferredName: "Sam",
  gender: "Male",
  mobileNo: "+85291234567",
  categoryType: "Sports Preferred",
  playerCoach: ["Player"],
  registeredTeam: "HKFC C",
  playingPosition: "Defender",
  sponsorId: U(101),
  officerId: U(102),
  chairId: U(103),
};

type Call = { url: URL; method: string; body: any };
/** PostgREST and Resend together; `tables` answers GETs by table name (`byEmail`: people looked up by email). */
function fake(tables: Record<string, unknown[]> = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.host === "api.resend.com") return reply({ id: "re_1" });
    const table = url.pathname.split("/").pop()!;
    if (table === "emails_sent_today") return reply(0);
    if (method === "POST" && table === "people") return reply([{ api_id: U(900) }]);
    if (method === "POST" && table === "steps") return reply([{ id: U(800) }]);
    if (method === "PATCH" && table === "steps") return reply([{ id: U(801) }]);
    if (method !== "GET") return reply([]);
    // The email lookup (createJoiner) apart from loading the joiner by id.
    if (table === "people" && url.searchParams.has("email")) return reply(tables.byEmail ?? []);
    if (table === "offices") return reply(url.searchParams.get("id") ? OFFICES.map(({ id, role }) => ({ id, role })) : OFFICES);
    return reply(tables[table] ?? []);
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const resend = (calls: Call[]) => calls.filter((c) => c.url.host === "api.resend.com").map((c) => c.body);
const writes = (calls: Call[], table: string, method: string) => calls.filter((c) => c.url.pathname.endsWith(`/${table}`) && c.method === method);

const joiner = {
  id: U(900), api_id: U(900), email: "sam.lee@example.com", preferred_name: "Sam", given_names: null, surname: null, chinese_name: null, date_of_birth: null,
  hkid_no: null, passport_no: null, nationality: null, gender: "Male", mobile_no: "+852 9123 4567", status: "Applicant", applicant_stage: null,
  applicant_type: "New HKFC Member", category_type: "Sports Preferred", player_coach: ["Player"], selected_team_sos: null, registered_team: "HKFC C",
  playing_position: "Defender", shirt_number_id: null, sponsored_by_sponsor_id: U(101), sponsored_by_officer_id: U(102), sponsored_by_chair_id: U(103),
  sponsored_by_kit_convenor_id: null, sponsored_by_hockey_convenor_id: null,
};

describe("the Section Captain's new joiner form", () => {
  it("checks the form and tidies the email and phone", () => {
    expect(joinerProblem(form)).toBeNull();
    expect(joinerProblem({ ...form, applicantType: "" })).toMatch(/type of application/);
    expect(joinerProblem({ ...form, email: "nope" })).toMatch(/email/);
    expect(joinerProblem({ ...form, mobileNo: "+852 123" })).toMatch(/8 digits/);
    expect(joinerProblem({ ...form, playerCoach: [] })).toMatch(/player, coach/);
    expect(joinerProblem({ ...form, sponsorId: "" })).toMatch(/sponsor/);
    const parsed = parseJoinerForm({ form: { ...form, extra: "x" } });
    expect(parsed.email).toBe("sam.lee@example.com");
    expect(parsed.mobileNo).toBe("+852 9123 4567");
    expect(parsed).not.toHaveProperty("extra");
  });

  it("is for Section Captains", async () => {
    fake();
    await expect(createJoiner(env, player, { form })).rejects.toThrow(/Section Captains/);
  });

  it("creates the applicant and, when asked, invites them from the captain's mailbox", async () => {
    const calls = fake({ people: [joiner] });
    const out = await createJoiner(env, captain, { form, invite: true });
    expect(out).toEqual({ id: U(900), invited: true });
    const [insert] = writes(calls, "people", "POST");
    expect(insert.body[0]).toMatchObject({ email: "sam.lee@example.com", status: "Applicant", active: false, sponsored_by_officer_id: U(102), mobile_no: "+852 9123 4567" });
    const [mail] = resend(calls);
    expect(mail.from).toBe("Ant Ford <menscaptain@hkfchockey.com>");
    expect(mail.to).toEqual(["sam.lee@example.com"]);
    // The vice captains' inbox once, and the sponsor for a new HKFC member; not the membership inbox.
    expect(mail.cc).toEqual(["mensvicecaptain@hkfchockey.com", "chris@x.com"]);
    expect(mail.text).toContain("https://app.eddy.global/apply");
    expect(mail.text).toContain("Gwen Laot and Ralph Giulianotti");
    expect(mail.text).toContain("I've also copied your sponsor, Chris Jones.");
    // Then stage 2.
    expect(writes(calls, "people", "PATCH").some((c) => c.body.applicant_stage === "2. Section Captain Invitation")).toBe(true);
  });

  it("won't propose a member, or someone already past the invitation", async () => {
    fake({ byEmail: [{ id: U(9), api_id: "recX", email: "sam.lee@example.com", status: "Member", applicant_stage: "Accepted" }] });
    await expect(createJoiner(env, captain, { form })).rejects.toThrow(/member already/);
    fake({ byEmail: [{ id: U(9), api_id: "recX", email: "sam.lee@example.com", status: "Applicant", applicant_stage: "4. Sponsor (Signed)" }] });
    await expect(createJoiner(env, captain, { form })).rejects.toThrow(/already in the New Joiner process/);
  });

  it("updates a trialist already in Eddy rather than adding them again", async () => {
    const calls = fake({ byEmail: [{ id: U(9), api_id: "recTRIAL", email: "SAM.LEE@example.com", status: "Trialist", applicant_stage: "1. Trial Application" }] });
    expect(await createJoiner(env, captain, { form })).toEqual({ id: "recTRIAL", invited: false });
    expect(writes(calls, "people", "POST")).toHaveLength(0);
    expect(writes(calls, "people", "PATCH")[0].url.search).toContain(U(9));
  });

  it("an existing HKFC member's invitation copies no sponsor", async () => {
    const calls = fake({ people: [{ ...joiner, applicant_type: "Existing HKFC Member" }] });
    await inviteJoiner(env, captain, U(900));
    const [mail] = resend(calls);
    expect(mail.cc).not.toContain("chris@x.com");
    expect(mail.text).toContain("Welcome to HKFC Men's Hockey.");
  });

  it("asks the Kit Convenor, opening their task, copied to the joiner and sponsor", async () => {
    const calls = fake({ people: [joiner], kit_sizes: [{ item: "shorts", size: "M" }, { item: "socks", size: "L" }] });
    await requestKit(env, captain, U(900), { convenorId: U(107) });
    const [step] = writes(calls, "steps", "POST");
    expect(step.body[0]).toMatchObject({ process: "new_joiner", step: "kit", person_id: U(900), waiting_on_person_id: U(7), waiting_on_role: "Kit Convenor" });
    const [mail] = resend(calls);
    expect(mail.to).toEqual(["kit@x.com"]);
    expect(mail.cc).toEqual(["sam.lee@example.com", "chris@x.com"]);
    expect(mail.subject).toBe("Kit Request for Sam");
    expect(mail.text).toContain("Shorts Size: M");
    expect(mail.text).toContain(`https://app.eddy.global/joiner-task/${U(800)}`);
    await expect(requestKit(env, captain, U(900), { convenorId: U(102) })).rejects.toThrow(/Kit Convenor/);
  });

  it("lets only the convenor it waits on, or a captain, mark a task done", async () => {
    const step = { id: U(800), step: "kit", person_id: U(900), started_at: "2026-10-01T00:00:00Z", done_at: null, waiting_on_person_id: U(7) };
    // Who they are came with sign-in (auth_context's uuid).
    fake({ steps: [step], people: [] });
    await expect(completeJoinerTask(env, { ...player, personUuid: U(55) }, U(800))).rejects.toThrow(/someone else/);
    const calls = fake({ steps: [step], people: [] });
    await completeJoinerTask(env, { ...player, personUuid: U(7) }, U(800));
    expect(writes(calls, "steps", "PATCH")[0].body).toMatchObject({ done_by_person_id: U(7) });
    // A kit task records no HKHA registration.
    expect(writes(calls, "hkha_registrations", "POST")).toEqual([]);
  });

  it("ticks a new joiner off the Convenor's registration list when their registration task is done", async () => {
    const step = { id: U(800), step: "registration", person_id: U(900), started_at: "2026-10-01T00:00:00Z", done_at: null, waiting_on_person_id: U(7) };
    // The joiner's team; the convenor's uuid came with sign-in.
    const calls = fake({ steps: [step], people: [{ id: U(900), registered_team: "HKFC C" }], hkha_registrations: [] });
    await completeJoinerTask(env, { ...player, personUuid: U(7) }, U(800));
    expect(calls.some((c) => c.method === "GET" && c.url.pathname.endsWith("/people") && c.url.searchParams.get("id") === `in.(${U(900)})`)).toBe(true);
    expect(writes(calls, "hkha_registrations", "POST")[0].body).toEqual([expect.objectContaining({ team: "HKFC C", registered_by_person_id: U(7) })]);
  });
});

describe("the emails' wording", () => {
  const sender = { name: "Ant Ford", designation: "Men's Captain" };
  it("leaves out the info sheet until the club has given Eddy a copy", () => {
    const base = {
      preferredName: "Sam", email: "s@x.com", newMember: true, viceCaptains: ["Gwen Laot"], viceCaptainEmail: "vc@x", officerName: "Daniel Cai",
      officerEmail: "mo@x", sponsorName: "Chris Jones", app: "https://a", infoSheetUrl: null, termsUrl: "https://a/terms.pdf", sender,
    };
    const without = invitationEmail(base).text;
    expect(without).not.toContain("Info Sheet");
    expect(without).toContain("1. Review and keep the Guidance Notes");
    expect(invitationEmail({ ...base, infoSheetUrl: "https://a/info.pdf" }).text).toContain("1. Review the New Members Info Sheet: https://a/info.pdf");
    expect(without).toContain("Men's Captain – HKFC Hockey Section");
  });

  it("kit and registration emails say what's missing rather than leaving gaps", () => {
    const kit = kitEmail({ convenorName: null, preferredName: "Sam", mobileNo: null, sponsorName: null, shirtNo: null, sizes: { shirt: null, shorts: null, socks: null }, taskUrl: "t", sender });
    expect(kit.text).toContain("Dear Kit Convenor,");
    expect(kit.text).toContain("Shirt No: to allocate");
    expect(kit.text).toContain("Could you please help");
    const reg = registrationEmail({ convenorName: "Jimmy", preferredName: "Sam", rows: [["Team", "HKFC C"], ["HKID No.", null]], taskUrl: "t", sender });
    expect(reg.subject).toBe("HKHA registration for Sam");
    expect(reg.text).toMatch(/HKID No\.\s+–/);
  });
});
