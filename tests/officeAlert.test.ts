import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { addOffice, editOffice, saveTeam } from "../worker/src/admin/club";
import { SENSITIVE_OFFICE_ROLES, officeAlertEmail, shouldAlertOffice } from "../worker/src/admin/officeAlert";

const env = {
  DATA_SUPABASE_URL: "https://proj.supabase.co",
  DATA_SUPABASE_SECRET_KEY: "sb_secret_test",
  RESEND_API_KEY: "re_test",
  MAIL_FROM: "Eddy <eddy@eddy.global>",
  SYSTEM_ALERT_EMAIL: "owner@hkfc.test",
  APP_ORIGIN: "https://app.eddy.global",
} as Env;
const captain = {
  email: "c@x.com", personId: "recCAPTAIN", role: "coach", coachTeams: [], isSectionCaptain: true,
  officerRoles: [{ office: "sectionCaptain", designation: "" }],
  person: { id: "recCAPTAIN", preferredName: "Al", surname: "Captain", email: "c@x.com", mobileNo: "9123 4567" },
} as unknown as AuthorizedUser;

const person = (api_id: string, preferred_name: string, surname: string) => ({ api_id, preferred_name, given_names: null, surname });
const officeRow = (api_id: string, role: string, status: string, p: ReturnType<typeof person>) => ({ id: `u-${api_id}`, api_id, role, status, person: p });

type Call = { url: URL; path: string; method: string; body: any };
/** PostgREST answers by path; Resend answers resendStatus. */
function fake(answers: Record<string, unknown>, resendStatus = 200) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const path = url.hostname === "api.resend.com" ? "resend" : url.pathname.replace("/rest/v1/", "");
      calls.push({ url, path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (path === "resend") return new Response(JSON.stringify(resendStatus === 200 ? { id: "msg1" } : { message: "boom" }), { status: resendStatus });
      if (path === "rpc/emails_sent_today") return new Response("0", { status: 200 });
      const answer = answers[path];
      return answer instanceof Response ? answer : new Response(JSON.stringify(answer ?? []), { status: 200 });
    }),
  );
  return { calls, emails: () => calls.filter((c) => c.path === "resend").map((c) => c.body) };
}
afterEach(() => vi.unstubAllGlobals());

describe("which office changes alert", () => {
  it("lists the offices that open personal data", () => {
    expect([...SENSITIVE_OFFICE_ROLES].sort()).toEqual(["hockey_convenor", "membership_officer", "section_captain", "section_chair"]);
  });

  it("alerts on a sensitive office either way, and on an office given to oneself", () => {
    expect(shouldAlertOffice(captain, "hockey_convenor", "ended", "recOTHER")).toBe(true);
    expect(shouldAlertOffice(captain, "sponsor", "granted", "recCAPTAIN")).toBe(true);
    expect(shouldAlertOffice(captain, "sponsor", "granted", "recOTHER")).toBe(false);
    expect(shouldAlertOffice(captain, "sponsor", "ended", "recCAPTAIN")).toBe(false);
  });

  it("writes names only, the time in Hong Kong and the /club link", () => {
    const at = new Date("2026-10-07T06:30:00Z");
    const c = { role: "membership_officer", change: "granted" as const, holderId: "recP1", holderName: "Pat Lam", replacedName: "Bo Yu" };
    expect(officeAlertEmail("Al Captain", false, c, at, "https://app.eddy.global/")).toEqual({
      subject: "Eddy: Membership Officer granted",
      text: "Al Captain made Pat Lam Membership Officer, taking over from Bo Yu.\nWed 7 Oct, 14:30, Hong Kong time\n\nhttps://app.eddy.global/club",
    });
    expect(officeAlertEmail("Al Captain", true, { ...c, role: "section_captain", change: "ended", replacedName: undefined }, at, "https://app.eddy.global").text)
      .toMatch(/^Al Captain retired themselves as Section Captain\./);
  });
});

describe("POST /api/admin/offices alerts", () => {
  it("emails once when someone gives an office to themselves", async () => {
    const f = fake({
      "rpc/admin_save_office": { status: "ok", id: "recNEW00000000001" },
      offices: [officeRow("recNEW00000000001", "sponsor", "Active", person("recCAPTAIN", "Al", "Captain"))],
    });
    expect(await addOffice(env, captain, { office: "sponsor", personId: "recCAPTAIN" })).toEqual({ ok: true, id: "recNEW00000000001" });
    expect(f.emails()).toHaveLength(1);
    expect(f.emails()[0]).toMatchObject({ to: ["owner@hkfc.test"], subject: "Eddy: Al Captain made themselves Sponsor" });
    expect(f.emails()[0].text).toMatch(/^Al Captain made themselves Sponsor\.\n.+Hong Kong time\n\nhttps:\/\/app\.eddy\.global\/club$/);
    expect(f.calls.find((c) => c.path === "email_log")!.body[0]).toMatchObject({ template: "office-change-alert", status: "sent" });
  });

  it("emails once for a sensitive office given to someone else, naming whose office it took over", async () => {
    const f = fake({
      "rpc/admin_save_office": { status: "ok", id: "recNEW00000000001" },
      offices: [
        officeRow("recNEW00000000001", "membership_officer", "Active", person("recP1", "Pat", "Lam")),
        officeRow("recOLD00000000001", "membership_officer", "Retired", person("recP2", "Bo", "Yu")),
      ],
    });
    await addOffice(env, captain, { office: "membershipOfficer", personId: "recP1", replaces: "recOLD00000000001" });
    expect(f.emails()).toHaveLength(1);
    expect(f.emails()[0].subject).toBe("Eddy: Membership Officer granted");
    expect(f.emails()[0].text).toContain("Al Captain made Pat Lam Membership Officer, taking over from Bo Yu.");
    // Names only: nothing else about the people.
    expect(f.emails()[0].text).not.toMatch(/@|9123/);
  });

  it("sends nothing, and reads nothing extra, for an ordinary office given to someone else", async () => {
    const f = fake({ "rpc/admin_save_office": { status: "ok", id: "recNEW00000000001" } });
    await addOffice(env, captain, { office: "kitConvenor", personId: "recP1" });
    expect(f.calls.map((c) => c.path)).toEqual(["rpc/admin_save_office"]);
  });

  it("still saves when the email fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fake({
      "rpc/admin_save_office": { status: "ok", id: "recNEW00000000001" },
      offices: [officeRow("recNEW00000000001", "hockey_convenor", "Active", person("recP1", "Pat", "Lam"))],
    }, 500);
    expect(await addOffice(env, captain, { office: "hockeyConvenor", personId: "recP1" })).toEqual({ ok: true, id: "recNEW00000000001" });
    expect(f.calls.find((c) => c.path === "email_log")!.body[0]).toMatchObject({ status: "failed" });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("sends nothing without SYSTEM_ALERT_EMAIL", async () => {
    const f = fake({ "rpc/admin_save_office": { status: "ok", id: "recNEW00000000001" } });
    await addOffice({ ...env, SYSTEM_ALERT_EMAIL: undefined } as Env, captain, { office: "sectionChair", personId: "recCAPTAIN" });
    expect(f.calls.map((c) => c.path)).toEqual(["rpc/admin_save_office"]);
  });
});

describe("POST /api/admin/offices/:id alerts", () => {
  it("emails once when a sensitive office is ended", async () => {
    const f = fake({
      offices: [officeRow("recO1", "hockey_convenor", "Active", person("recP1", "Pat", "Lam"))],
      "rpc/admin_save_office": { status: "ok", id: "recO1" },
    });
    await editOffice(env, captain, "recO1", { status: "Retired" });
    expect(f.calls[0].path).toBe("offices");
    expect(f.emails()).toHaveLength(1);
    expect(f.emails()[0].subject).toBe("Eddy: Men's Convenor ended");
    expect(f.emails()[0].text).toContain("Al Captain retired Pat Lam as Men's Convenor.");
  });

  it("emails when someone makes their own retired office Active again", async () => {
    const f = fake({
      offices: [officeRow("recO1", "sponsor", "Retired", person("recCAPTAIN", "Al", "Captain"))],
      "rpc/admin_save_office": { status: "ok", id: "recO1" },
    });
    await editOffice(env, captain, "recO1", { status: "Active" });
    expect(f.emails().map((e) => e.subject)).toEqual(["Eddy: Al Captain made themselves Sponsor"]);
  });

  it("sends nothing for an ordinary office, a status that didn't change, or a designation edit", async () => {
    let f = fake({ offices: [officeRow("recO1", "sponsor", "Active", person("recP1", "Pat", "Lam"))], "rpc/admin_save_office": { status: "ok", id: "recO1" } });
    await editOffice(env, captain, "recO1", { status: "Retired" });
    expect(f.emails()).toHaveLength(0);
    f = fake({ offices: [officeRow("recO1", "section_chair", "Retired", person("recP1", "Pat", "Lam"))], "rpc/admin_save_office": { status: "ok", id: "recO1" } });
    await editOffice(env, captain, "recO1", { status: "Retired" });
    expect(f.emails()).toHaveLength(0);
    f = fake({ "rpc/admin_save_office": { status: "ok", id: "recO1" } });
    await editOffice(env, captain, "recO1", { designation: "Vice" });
    expect(f.calls.map((c) => c.path)).toEqual(["rpc/admin_save_office"]);
  });

  it("still saves, without an email, when the office can't be read first", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fake({
      offices: new Response(JSON.stringify({ message: "boom" }), { status: 400 }),
      "rpc/admin_save_office": { status: "ok", id: "recO1" },
    });
    expect(await editOffice(env, captain, "recO1", { status: "Retired" })).toEqual({ ok: true, id: "recO1" });
    expect(f.emails()).toHaveLength(0);
    error.mockRestore();
  });

  it("sends nothing when the save is refused", async () => {
    const f = fake({
      offices: [officeRow("recO1", "section_captain", "Active", person("recP1", "Pat", "Lam"))],
      "rpc/admin_save_office": { status: "conflict", code: "LAST_SECTION_CAPTAIN" },
    });
    await expect(editOffice(env, captain, "recO1", { status: "Retired" })).rejects.toMatchObject({ status: 409 });
    expect(f.emails()).toHaveLength(0);
  });
});

describe("team saves", () => {
  it("never alert: /club teams can't grant a Section Captain link", async () => {
    const f = fake({ "rpc/admin_save_team": { status: "ok", changed: ["coach"] } });
    await saveTeam(env, captain, "recT1", { coachIds: ["recCAPTAIN"] });
    expect(f.calls.map((c) => c.path)).toEqual(["rpc/admin_save_team"]);
  });
});
