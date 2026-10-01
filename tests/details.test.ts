import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { getMyDetails, parseSection, saveKitSizes, saveSection, uploadBytes } from "../worker/src/details";
import { checkedThisSeason, checkValue, PROFILE_SECTIONS } from "../shared/profile";

const env = { DATA_BACKEND: "supabase", DATA_SUPABASE_URL: "https://proj.supabase.co", DATA_SUPABASE_SECRET_KEY: "sb_secret_test", FILE_LINK_SECRET: "x" } as unknown as Env;
const user = { email: "p@x.com", personId: "recME", role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [] } as unknown as AuthorizedUser;

type Call = { url: URL; method: string; body: any };
function fake(tables: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(tables[url.pathname.split("/").pop()!] ?? []), { status: 200 });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const personal = {
  surname: "Lee", givenNames: "Sam", preferredName: "Sam", dateOfBirth: "1990-01-01", gender: "Male", hkidNo: "A123456(7)", nationality: "British",
};

describe("my details", () => {
  it("checks a section's answers and writes only its columns, applicant-only questions for applicants alone", () => {
    const member = parseSection("personal", { values: { ...personal, maritalStatus: "Married" } }, false);
    expect(member).toMatchObject({ surname: "Lee", given_names: "Sam", hkid_no: "A123456(7)", chinese_name: null });
    expect(member).not.toHaveProperty("marital_status");
    expect(parseSection("personal", { values: { ...personal, maritalStatus: "Married" } }, true)).toMatchObject({ marital_status: "Married" });
    expect(() => parseSection("personal", { values: { ...personal, surname: " " } }, false)).toThrow(/Surname is needed/);
    expect(() => parseSection("personal", { values: { ...personal, gender: "Other" } }, false)).toThrow(/choose from the list/);
    expect(() => parseSection("nope", { values: {} }, false)).toThrow(/Unknown section/);
  });

  it("saves only 'not active' when a member won't play this season, and the hockey answers when they will", () => {
    expect(parseSection("hockey", { values: { active: false, playingPosition: "" } }, false)).toEqual({ active: false });
    expect(parseSection("hockey", { values: { active: true, playingPosition: "Goalkeeper", playingLevel: ["Division 2"] } }, false)).toMatchObject({
      active: true, playing_position: "Goalkeeper", playing_level: ["Division 2"], selection_comments: null,
    });
    expect(() => parseSection("hockey", { values: { playingPosition: "Goalkeeper" } }, false)).toThrow(/active member/);
    // Applicants aren't asked whether they'll be active, or for selection comments.
    expect(parseSection("hockey", { values: { playingPosition: "Forward" } }, true)).toEqual({ playing_position: "Forward", playing_level: [] });
  });

  it("asks bank details of new joiners only, and checks the limit amount is a number", async () => {
    fake({ people: [{ id: "u1", api_id: "recME", status: "Member" }] });
    await expect(saveSection(env, user, "billing", { values: { bankName: "HSBC" } })).rejects.toThrow(/new joiners only/);
    expect(parseSection("billing", { values: {} }, true)).toMatchObject({ bank_name: null, bank_payment_limit_amount: null, billing_channels: [] });
    expect(parseSection("billing", { values: { bankName: "HSBC", bankPaymentLimit: "Each Month", bankPaymentLimitAmount: "5000" } }, true)).toMatchObject({
      bank_name: "HSBC", bank_payment_limit: "Each Month", bank_payment_limit_amount: 5000,
    });
    expect(() => parseSection("billing", { values: { bankPaymentLimitAmount: "lots" } }, true)).toThrow(/number/);
    expect(() => parseSection("billing", { values: { bankName: "Bank of Nowhere" } }, true)).toThrow(/list/);
  });

  it("takes any nationality or district, but checks emails, phones and dates", () => {
    const f = (key: string) => PROFILE_SECTIONS.flatMap((s) => s.fields).find((x) => x.key === key)!;
    expect(checkValue(f("nationality"), "Belgium ")).toBeNull();
    expect(checkValue(f("homeDistrict"), "Somewhere New")).toBeNull();
    expect(checkValue(f("guardianEmail"), "not-an-email")).toMatch(/email/);
    expect(checkValue(f("mobileNo"), "+852 9123 4567")).toBeNull();
    expect(checkValue(f("mobileNo"), "call me")).toMatch(/phone/);
    expect(checkValue(f("dateOfBirth"), "01/01/1990")).toMatch(/date/);
  });

  it("asks for a parent or guardian only for under-18s", async () => {
    fake({ people: [{ id: "u1", api_id: "recME", status: "Member", date_of_birth: "1990-01-01" }] });
    await expect(saveSection(env, user, "guardian", { values: { guardianSurname: "Lee" } })).rejects.toMatchObject({ status: 400 });
  });

  it("counts the details as checked this season from 1 July", () => {
    expect(checkedThisSeason("2026-07-01T02:00:00Z", "2026-10-01")).toBe(true);
    expect(checkedThisSeason("2026-06-30T10:00:00Z", "2026-10-01")).toBe(false);
    expect(checkedThisSeason(null, "2026-10-01")).toBe(false);
  });

  it("accepts photos and HKID copies of the right type and size only", () => {
    const png = `data:image/png;base64,${btoa("x".repeat(10))}`;
    expect(uploadBytes("photo", png).type).toBe("image/png");
    expect(() => uploadBytes("photo", "data:application/pdf;base64,AAAA")).toThrow(/photo/);
    expect(uploadBytes("hkid", "data:application/pdf;base64,AAAA").type).toBe("application/pdf");
    expect(() => uploadBytes("hkid", `data:image/jpeg;base64,${btoa("x".repeat(5_000_001))}`)).toThrow(/5 MB/);
  });

  it("keeps a printed shirt's size when saving kit sizes", async () => {
    const calls = fake({
      people: [{ id: "u1", api_id: "recME", status: "Member", shirt_number_id: "n1", playing_position: "Defender" }],
      kit_orders: [{ id: "o1", supplier: "Kukri" }],
      kit_sizes: [],
      kit_sets_v: [{ id: "k1", shirt_no: 92, shirt: "XL" }],
    });
    await saveKitSizes(env, user, { sizes: { shirt: "M", shorts: "L", socks: "Large" } });
    const upsert = calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/kit_sizes"))!;
    expect(upsert.body).toEqual([
      { person_id: "u1", supplier: "Kukri", item: "shirt", size: "XL" },
      { person_id: "u1", supplier: "Kukri", item: "shorts", size: "L" },
      { person_id: "u1", supplier: "Kukri", item: "socks", size: "Large" },
    ]);
    await expect(saveKitSizes(env, user, { sizes: { shirt: "M" } })).rejects.toMatchObject({ status: 400 });
  });

  it("reads the details, the membership facts and the kit", async () => {
    fake({
      people: [{ id: "u1", api_id: "recME", status: "Member", email: "p@x.com", surname: "Lee", academic_qualifications: ["Secondary"], membership_no: "123", player_coach: ["Player"], date_of_birth: "2012-01-01" }],
      current_season: "2026-2027",
      files: [{ id: "f2", kind: "hkid" }],
      kit_orders: [],
    });
    const d = await getMyDetails(env, user);
    expect(d).toMatchObject({ season: "2026-2027", applicant: false, underEighteen: true, email: "p@x.com", photoUrl: null, hasHkidCopy: true, kit: null });
    expect(d.values).toMatchObject({ surname: "Lee", academicQualifications: ["Secondary"], chineseName: null });
    expect(d.membership).toMatchObject({ membershipNo: "123", playerCoach: ["Player"] });
    await expect(getMyDetails({ ...env, DATA_BACKEND: "airtable" } as Env, user)).rejects.toMatchObject({ status: 409 });
  });
});
