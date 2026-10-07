import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { declineRegistration, invitePracticeTrial, registerInterest, registrationGaps, saveMyTrial, submitRegistration } from "../worker/src/trials";
import { parseSection } from "../worker/src/details";

const env = {
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  RESEND_API_KEY: "re_test",
  MAIL_FROM: "Eddy <notifications@eddy.global>",
  APP_ORIGIN: "https://app.eddy.global",
  REVIEW_EMAIL_FROM: "Anthony Ford <menscaptain@hkfchockey.com>",
} as Env;

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const captain = { email: "a@x.com", personId: "recCAPTAIN", officerRoles: [{ office: "sectionCaptain", designation: "Men's Captain" }] } as unknown as AuthorizedUser;
const trialistUser = { email: "sam@x.com", personId: U(1), officerRoles: [] } as unknown as AuthorizedUser;

const trialist = {
  id: U(1), api_id: U(1), email: "sam@x.com", status: "Applicant", applicant_stage: "1. Trial Application", trial_registered_at: null, referred_by_id: U(50),
  preferred_name: "Sam", given_names: "Samuel", surname: "Lee", playing_position: "Forward", playing_level: ["Division 1"], qualified_umpire: "Level 1",
  qualified_coach: null, nationality: "British", hkid_no: null, passport_no: "K123", sports_background: "County hockey", mobile_no: "+852 9123 4567",
};

type Call = { url: URL; method: string; body: any };
function fake(tables: Record<string, unknown[]> = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.host === "api.resend.com") return reply({ id: "re_1" });
    const table = url.pathname.split("/").pop()!;
    if (table === "emails_sent_today") return reply(0);
    if (method !== "GET") return reply([{ id: U(700) }]);
    if (table === "people" && url.searchParams.has("email")) return reply(tables.byEmail ?? []);
    return reply(tables[table] ?? []);
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const writes = (calls: Call[], table: string, method: string) => calls.filter((c) => c.url.pathname.endsWith(`/${table}`) && c.method === method);
const resend = (calls: Call[]) => calls.filter((c) => c.url.host === "api.resend.com").map((c) => c.body);

describe("registering to join", () => {
  it("signs up a new email at stage 1, remembering the member whose link it was", async () => {
    const calls = fake({ people: [{ id: U(50) }] });
    expect(await registerInterest(env, "new@x.com", { ref: "recMEMBER" })).toEqual({ status: "registering", stage: "1. Trial Application" });
    const [insert] = writes(calls, "people", "POST");
    expect(insert.body[0]).toEqual({ email: "new@x.com", status: "Applicant", applicant_stage: "1. Trial Application", active: false, referred_by_id: U(50) });
    // Only a member counts as the referrer.
    expect(calls.find((c) => c.url.searchParams.get("api_id") === "eq.recMEMBER")!.url.searchParams.get("status")).toBe("eq.Member");
  });

  it("tells someone already in Eddy where they stand instead", async () => {
    fake({ byEmail: [{ id: U(9), email: "Sam@X.com", status: "Member", applicant_stage: "Accepted" }] });
    expect(await registerInterest(env, "sam@x.com", {})).toEqual({ status: "member", stage: "Accepted" });
    const calls = fake({ byEmail: [{ id: U(9), email: "sam@x.com", status: "Applicant", applicant_stage: "2. Section Captain Invitation" }] });
    expect(await registerInterest(env, "sam@x.com", {})).toEqual({ status: "applicant", stage: "2. Section Captain Invitation" });
    expect(writes(calls, "people", "POST")).toHaveLength(0);
  });

  it("takes only upcoming trial sessions", async () => {
    const soon = new Date(Date.now() + 86_400_000).toISOString();
    fake({ people: [trialist], trial_sessions: [{ id: U(300), starts_at: soon, place: "HKFC", notes: null }] });
    await expect(saveMyTrial(env, trialistUser, { sessionIds: [U(301)] })).rejects.toThrow(/sessions listed/);
    const calls = fake({ people: [trialist], trial_sessions: [{ id: U(300), starts_at: soon, place: "HKFC", notes: null }] });
    await saveMyTrial(env, trialistUser, { sessionIds: [U(300)] });
    expect(writes(calls, "trial_availability", "POST")[0].body).toEqual([{ person_id: U(1), session_id: U(300) }]);
  });

  it("asks everyone for their hockey CV, whatever their type of application", () => {
    expect(() => parseSection("background", { values: { sportsBackground: "County", personalInterest: "Sailing" } }, "existing")).toThrow(/isn't asked of you/);
    expect(parseSection("background", { values: { sportsBackground: "County", personalInterest: "Sailing" } }, "existing", { trialist: true })).toEqual({
      sports_background: "County",
      personal_interest: "Sailing",
    });
    const gaps = registrationGaps({ applicant_type: "Existing HKFC Member" }, false, "2026-10-01");
    expect(gaps.some((g) => g.startsWith("About you"))).toBe(true);
    expect(gaps).toContain("Personal details: upload your photo.");
  });

  it("won't send an unfinished registration", async () => {
    fake({ people: [trialist] });
    await expect(submitRegistration(env, trialistUser)).rejects.toThrow(/Not quite finished/);
  });
});

describe("the Section Captains' practice trial", () => {
  const teams = [{ id: U(400), team_name: "HKFC A" }];
  const coaches = [{ people: { id: U(60), email: "coach@x.com", preferred_name: "Coachie", given_names: null } }];
  const captainRow = [{ preferred_name: "Ant", given_names: null, surname: "Ford", offices: [{ office_email: "menscaptain@hkfchockey.com", designation: "Men's Captain", role: "section_captain" }] }];
  /** The Active Assistant Director of Hockey office, with its holder. */
  const adhOffice = (mailbox: string | null) => ({
    id: U(500), role: "assistant_director", designation: "Assistant Director of Hockey", office_email: mailbox, person_id: U(70),
    people: { id: U(70), api_id: "recADH", preferred_name: "Lee", given_names: "Shirndre-Lee", surname: "Simmons", email: "lee@x.com" },
  });

  /** The fake, with the captain lookup (it shares the people table) answered with the captain. */
  function fakeWithCaptain(tables: Record<string, unknown[]>) {
    const calls = fake(tables);
    const base = (globalThis.fetch as any).getMockImplementation();
    (globalThis.fetch as any).mockImplementation(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/people") && url.searchParams.get("select")?.includes("offices")) {
        calls.push({ url, method: "GET", body: undefined });
        return new Response(JSON.stringify(captainRow), { status: 200 });
      }
      return base(input, init);
    });
    return calls;
  }

  it("emails the ADH and the team's coach the hockey CV, and tells the player when to come", async () => {
    const calls = fakeWithCaptain({ people: [trialist], teams, team_people: coaches, offices: [adhOffice("adh@example.com")] });
    await invitePracticeTrial(env, captain, U(1), { team: "HKFC A", when: "Tue 7 Oct, 20:00, HKFC" });
    expect(calls.filter((c) => c.url.pathname.endsWith("/people") && c.url.searchParams.get("select")?.includes("offices"))).toHaveLength(1);
    // The ADH comes from the offices table: the Active assistant_director, in one read.
    const officeReads = calls.filter((c) => c.url.pathname.endsWith("/offices"));
    expect(officeReads).toHaveLength(1);
    expect(officeReads[0].url.searchParams.get("role")).toBe("eq.assistant_director");
    expect(officeReads[0].url.searchParams.get("status")).toBe("eq.Active");
    const [coach, player] = resend(calls);
    expect(coach.to).toEqual(["adh@example.com"]);
    expect(coach.cc).toEqual(["coach@x.com"]);
    expect(coach.from).toBe("Ant Ford <menscaptain@hkfchockey.com>");
    expect(coach.subject).toBe("Practice trial: Sam Lee");
    expect(coach.text).toContain("Dear Lee and Coachie,");
    expect(coach.text).toContain("no HKID: a visiting player");
    expect(coach.text).toContain("HKFC A practice: Tue 7 Oct, 20:00, HKFC");
    expect(player.to).toEqual(["sam@x.com"]);
    expect(player.text).toContain("Tue 7 Oct, 20:00, HKFC");
  });

  it("writes to the ADH's own email when the office has no mailbox, and to the coach alone when nobody holds it", async () => {
    let calls = fakeWithCaptain({ people: [trialist], teams, team_people: coaches, offices: [adhOffice(null)] });
    await invitePracticeTrial(env, captain, U(1), { team: "HKFC A", when: "Tue 7 Oct, 20:00, HKFC" });
    expect(resend(calls)[0].to).toEqual(["lee@x.com"]);
    expect(resend(calls)[0].cc).toEqual(["coach@x.com"]);

    calls = fakeWithCaptain({ people: [trialist], teams, team_people: coaches, offices: [] });
    await invitePracticeTrial(env, captain, U(1), { team: "HKFC A", when: "Tue 7 Oct, 20:00, HKFC" });
    const [coach] = resend(calls);
    expect(coach.to).toEqual(["coach@x.com"]);
    expect(coach.cc).toBeUndefined();
    expect(coach.text).toContain("Dear Coachie,");

    fakeWithCaptain({ people: [trialist], teams, team_people: [], offices: [] });
    await expect(invitePracticeTrial(env, captain, U(1), { team: "HKFC A", when: "x" })).rejects.toThrow(/Neither the Assistant Director/);
  });

  it("is for Section Captains, needs a team and when, and only for stage 1", async () => {
    fake({ people: [trialist], teams });
    await expect(invitePracticeTrial(env, trialistUser, U(1), { team: "HKFC A", when: "x" })).rejects.toThrow(/Section Captains/);
    await expect(invitePracticeTrial(env, captain, U(1), { team: "", when: "x" })).rejects.toThrow(/team/);
    await expect(invitePracticeTrial(env, captain, U(1), { team: "HKFC A", when: "" })).rejects.toThrow(/when and where/);
    fake({ people: [{ ...trialist, applicant_stage: "2. Section Captain Invitation" }], teams });
    await expect(invitePracticeTrial(env, captain, U(1), { team: "HKFC A", when: "x" })).rejects.toThrow(/registered to join/);
  });

  it("not this time parks the registration without an email", async () => {
    const calls = fake({ people: [{ id: U(1), applicant_stage: "1. Trial Application" }] });
    await declineRegistration(env, captain, U(1));
    expect(writes(calls, "people", "PATCH")[0].body).toEqual({ applicant_stage: "Rejected" });
    expect(resend(calls)).toHaveLength(0);
  });
});
