import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { getMyDetails, parseSection, saveKitSizes, saveSection, uploadBytes } from "../worker/src/details";
import { checkedThisSeason, checkValue, formatHkAddress, PROFILE_SECTIONS, regionOfDistrict } from "../shared/profile";
import { joinPhone, normaliseHkid, splitPhone } from "../shared/phone";

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
  surname: "Lee", givenNames: "Sam", preferredName: "Sam", dateOfBirth: "1990-01-01", gender: "Male", hkidNo: "a1234563", nationality: "British",
};

describe("my details", () => {
  it("checks a section's answers and writes only its columns, applicant-only questions for applicants alone", () => {
    const member = parseSection("personal", { values: { ...personal, maritalStatus: "Married" } }, "member");
    expect(member).toMatchObject({ surname: "Lee", given_names: "Sam", hkid_no: "A123456(3)", chinese_name: null }); // written the standard way
    expect(member).not.toHaveProperty("marital_status");
    const newcomer = { ...personal, maritalStatus: "Married", placeOfBirth: "London", arrivedInHkOn: "2020-01-01" };
    expect(parseSection("personal", { values: newcomer }, "new")).toMatchObject({ marital_status: "Married", place_of_birth: "London" });
    // New HKFC members also give where they were born and when they arrived; existing ones don't.
    expect(() => parseSection("personal", { values: { ...personal, maritalStatus: "Married" } }, "new")).toThrow(/Place of birth/);
    expect(parseSection("personal", { values: { ...personal, maritalStatus: "Single" } }, "existing")).not.toHaveProperty("place_of_birth");
    expect(() => parseSection("personal", { values: { ...personal, surname: " " } }, "member")).toThrow(/Surname is needed/);
    expect(() => parseSection("personal", { values: { ...personal, gender: "Other" } }, "member")).toThrow(/choose from the list/);
    expect(() => parseSection("nope", { values: {} }, "member")).toThrow(/Unknown section/);
  });

  it("saves only 'not active' when a member won't play this season, and the hockey answers when they will", () => {
    expect(parseSection("hockey", { values: { active: false, playingPosition: "" } }, "member")).toEqual({ active: false });
    expect(parseSection("hockey", { values: { active: true, playingPosition: "Goalkeeper", playingLevel: ["Division 2"] } }, "member")).toMatchObject({
      active: true, playing_position: "Goalkeeper", playing_level: ["Division 2"], selection_comments: null,
    });
    expect(() => parseSection("hockey", { values: { playingPosition: "Goalkeeper" } }, "member")).toThrow(/active member/);
    // Applicants aren't asked whether they'll be active, or for selection comments.
    expect(parseSection("hockey", { values: { playingPosition: "Forward", playingLevel: ["Division 3"] } }, "new")).toEqual({ playing_position: "Forward", playing_level: ["Division 3"] });
    expect(() => parseSection("hockey", { values: { playingPosition: "Forward" } }, "new")).toThrow(/Levels/);
  });

  it("asks bank details of new HKFC members only, with the rules across its answers", async () => {
    fake({ people: [{ id: "u1", api_id: "recME", status: "Member" }] });
    await expect(saveSection(env, user, "billing", { values: { bankName: "HSBC" } })).rejects.toThrow(/isn't asked of you/);
    expect(() => parseSection("billing", { values: {} }, "existing")).toThrow(/isn't asked of you/);
    const bank = { bankBranchNo: "123", bankAccountNo: "456789", bankPaymentLimit: "Unlimited" };
    expect(parseSection("billing", { values: bank }, "new")).toMatchObject({ bank_branch_no: "123", bank_payment_limit_amount: null });
    expect(() => parseSection("billing", { values: { ...bank, bankPaymentLimit: "Each Month" } }, "new")).toThrow(/limit amount/);
    expect(() => parseSection("billing", { values: { ...bank, billPayer: "Guardian / Parent" } }, "new")).toThrow(/parent or guardian's name/);
    expect(parseSection("billing", { values: { ...bank, bankName: "HSBC", bankPaymentLimit: "Each Month", bankPaymentLimitAmount: "5000" } }, "new")).toMatchObject({
      bank_name: "HSBC", bank_payment_limit: "Each Month", bank_payment_limit_amount: 5000,
    });
    expect(() => parseSection("billing", { values: { ...bank, bankPaymentLimitAmount: "lots" } }, "new")).toThrow(/number/);
    expect(() => parseSection("billing", { values: { ...bank, bankName: "Bank of Nowhere" } }, "new")).toThrow(/list/);
  });

  it("checks HKID numbers by their check digit and writes them the standard way", () => {
    expect(normaliseHkid("a1234563")).toBe("A123456(3)");
    expect(normaliseHkid("AB987654(3)")).toBe("AB987654(3)");
    expect(normaliseHkid("Z123456 (1)")).toBe("Z123456(1)");
    expect(normaliseHkid("A123456(7)")).toBeNull();
    expect(normaliseHkid("123456")).toBeNull();
  });

  it("splits and joins phone numbers by country code, Hong Kong's as 4 + 4", () => {
    expect(splitPhone("+852 9123 4567")).toEqual({ code: "+852", number: "91234567" });
    expect(splitPhone("+85291234567")).toEqual({ code: "+852", number: "91234567" });
    expect(splitPhone("+447911123456")).toEqual({ code: "+44", number: "7911123456" });
    expect(splitPhone("9123 4567")).toEqual({ code: "+852", number: "9123 4567" });
    expect(joinPhone("+852", "9123-4567")).toBe("+852 9123 4567");
    expect(joinPhone("+61", "412 345 678")).toBe("+61 412345678");
  });

  it("writes an address as Hong Kong Post does, and fills in the district's region", () => {
    expect(formatHkAddress({ homeFlatType: "Flat", homeUnit: "B", homeFloor: "12", homeBlock: "3", homeBuilding: "Example Court", homeStreet: "1 Sample Road", homeDistrict: "Mid-Levels", homeRegion: "Hong Kong" }, "home")).toEqual([
      "Flat B, 12/F, Block 3", "Example Court", "1 Sample Road", "Mid-Levels, Hong Kong",
    ]);
    expect(formatHkAddress({ businessFloor: "G", businessBuilding: "Tower One" }, "business")).toEqual(["G/F", "Tower One"]);
    expect(regionOfDistrict("Sai Kung")).toBe("New Territories");
    expect(regionOfDistrict("Somewhere")).toBeNull();
  });

  it("takes any nationality or district, but checks emails, phones and dates", () => {
    const f = (key: string) => PROFILE_SECTIONS.flatMap((s) => s.fields).find((x) => x.key === key)!;
    expect(checkValue(f("nationality"), "Belgium ")).toBeNull();
    expect(checkValue(f("homeDistrict"), "Somewhere New")).toBeNull();
    expect(checkValue(f("guardianEmail"), "not-an-email")).toMatch(/email/);
    expect(checkValue(f("mobileNo"), "+852 9123 4567")).toBeNull();
    expect(checkValue(f("mobileNo"), "call me")).toMatch(/8 digits/);
    expect(checkValue(f("mobileNo"), "+852 9123 456")).toMatch(/8 digits/);
    expect(checkValue(f("mobileNo"), "+44 7911123456")).toBeNull();
    expect(checkValue(f("hkidNo"), "A123456(3)")).toBeNull();
    expect(checkValue(f("hkidNo"), "A123456(7)")).toMatch(/digit in brackets/);
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
