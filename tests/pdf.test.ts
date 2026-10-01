import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { CJK_FONT, renderDocument, RenderError, drawable } from "../supabase/functions/_shared/pdf";
import { ddmmyyyy, playerStatementSpec, type PlayerStatementFacts } from "../worker/src/pdf/playerStatement";
import { CLUB_NAME, u18Spec, type U18Facts } from "../worker/src/pdf/u18Registration";
import { documentFilename, needsCjkFont } from "../worker/src/pdf/render";

// Noto Sans TC cut down to a few characters (tests/fixtures, SIL Open Font License).
const TEST_FONT = new Uint8Array(readFileSync(new URL("./fixtures/noto-sans-tc-test.ttf", import.meta.url)));

// A 1x1 PNG, standing in for a signature or a photo.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));

/** A small fillable template: a text field, a checkbox, a radio group and a button (a photo box). */
async function template(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  const form = doc.getForm();
  const page = doc.getPage(0);
  form.createTextField("name").addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  form.createCheckBox("hockey").addToPage(page, { x: 50, y: 650, width: 10, height: 10 });
  const radio = form.createRadioGroup("salutation");
  radio.addOptionToPage("Mr", page, { x: 50, y: 600, width: 10, height: 10 });
  radio.addOptionToPage("Ms", page, { x: 80, y: 600, width: 10, height: 10 });
  form.createButton("photo").addToPage("", page, { x: 400, y: 650, width: 80, height: 100 });
  return doc.save();
}

describe("renderDocument", () => {
  it("fills, flattens and keeps every page", async () => {
    const { pdf, pages, warnings } = await renderDocument(
      {
        title: "Test",
        parts: [{
          kind: "template",
          asset: "t",
          fields: { name: "Testy McTestface", hockey: true, salutation: "Ms" },
          fieldImages: { photo: "pic" },
          text: [{ page: 2, x: 50, y: 50, text: "Overlay" }],
          images: [{ page: 2, x: 50, y: 100, width: 100, height: 30, asset: "pic" }],
        }],
      },
      { t: await template(), pic: PNG },
    );
    expect(pages).toBe(2);
    expect(warnings).toEqual([]);
    const out = await PDFDocument.load(pdf);
    expect(out.getForm().getFields()).toHaveLength(0); // flattened, photo field removed
    expect(out.getTitle()).toBe("Test");
  });

  it("keeps only the pages asked for, in order", async () => {
    const { pages } = await renderDocument({ title: "T", parts: [{ kind: "template", asset: "t", pages: [2] }] }, { t: await template(3) });
    expect(pages).toBe(1);
  });

  it("appends image pages and uploaded PDFs", async () => {
    const upload = await PDFDocument.create();
    upload.addPage();
    upload.addPage();
    const { pages } = await renderDocument(
      {
        title: "T",
        parts: [
          { kind: "template", asset: "t" },
          { kind: "image", asset: "hkid", caption: "HKID" },
          { kind: "pdf", asset: "cert" },
        ],
      },
      { t: await template(1), hkid: PNG, cert: await upload.save() },
    );
    expect(pages).toBe(1 + 1 + 2);
  });

  it("leaves out characters Helvetica cannot draw, and says so without the value", async () => {
    const { warnings } = await renderDocument(
      { title: "T", parts: [{ kind: "template", asset: "t", fields: { name: "陳大文 Chan Tai Man" } }] },
      { t: await template(1) },
    );
    expect(warnings).toEqual(['t "name": 3 character(s) the font cannot draw were left out']);
    expect(warnings.join(" ")).not.toContain("Chan");
  });

  it("draws Chinese in the Chinese font when it is sent, in fields and overlaid text", async () => {
    const { pdf, warnings } = await renderDocument(
      {
        title: "T",
        parts: [{
          kind: "template",
          asset: "t",
          fields: { name: "陳大文 Chan Tai Man" },
          text: [{ page: 1, x: 50, y: 50, text: "香港足球會" }],
        }],
      },
      { t: await template(1), [CJK_FONT]: TEST_FONT },
    );
    expect(warnings).toEqual([]);
    // Only the characters used are embedded: the PDF stays small.
    expect(pdf.length).toBeLessThan(20_000);
    expect((await PDFDocument.load(pdf)).getForm().getFields()).toHaveLength(0);
  });

  it("reports characters even the Chinese font lacks", async () => {
    const { warnings } = await renderDocument(
      { title: "T", parts: [{ kind: "template", asset: "t", text: [{ page: 1, x: 50, y: 50, text: "陳大文 龍" }] }] },
      { t: await template(1), [CJK_FONT]: TEST_FONT },
    );
    expect(warnings).toEqual(["t text on page 1: 1 character(s) the font cannot draw were left out"]);
  });

  it("turns typographic punctuation into plain characters", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const warnings: string[] = [];
    expect(drawable(font, "O’Brien – “Coach”…", warnings, "x")).toBe("O'Brien - \"Coach\"...");
    expect(warnings).toEqual([]);
  });

  it("refuses a field the template does not have, a missing asset, and a bad radio option", async () => {
    const t = await template(1);
    await expect(renderDocument({ title: "T", parts: [{ kind: "template", asset: "t", fields: { nope: "x" } }] }, { t })).rejects.toThrow(RenderError);
    await expect(renderDocument({ title: "T", parts: [{ kind: "template", asset: "missing" }] }, { t })).rejects.toThrow('Missing asset "missing"');
    await expect(renderDocument({ title: "T", parts: [{ kind: "template", asset: "t", fields: { salutation: "Dr" } }] }, { t })).rejects.toThrow("no option");
    await expect(renderDocument({ title: "T", parts: [] }, {})).rejects.toThrow("Nothing to render");
  });
});

const statement: PlayerStatementFacts = {
  candidateName: "Testy McTestface",
  joinDate: "2024-09-01",
  teamsPlayed: ["Men's 3", "Men's 4"],
  currentTeam: "Men's 3",
  position: "Midfield",
  matchesPlayed: 14,
  matchesTeamPlayed: 18,
  matchesNotAvailable: 2,
  practices: "Moderate 50-70%",
  socialFunctions: [],
  sectionService: "Sunday juniors",
  hkfcService: "Social Committee",
  recommendation: "Committed",
  playersAvailable: 21,
  optimumPlayers: 18,
  isPlayerNeeded: "Yes",
  otherComments: "Good umpire",
  recommendedReduction: "1 year",
  sponsor: { name: "Sam Sponsor", designation: "Sponsor", date: "2026-09-20T10:00:00Z", signed: true },
  officer: { name: "Morgan Officer", designation: "Membership Officer", date: "2026-09-28", signed: false },
};

describe("playerStatementSpec", () => {
  const part = playerStatementSpec(statement).parts[0];
  if (part.kind !== "template") throw new Error("expected a template part");

  it("maps the review onto the form's fields", () => {
    expect(part.fields).toMatchObject({
      date_joined: "01/09/2024",
      candidate_name: "Testy McTestface",
      sec_hockey: true,
      teams_played: "Men's 3, Men's 4",
      not_available: "2",
      available_and_played: "14",
      games_available_dnp: "2", // 18 - 14 - 2
      training_very_regular: false,
      training_moderate: true,
      training_hardly_ever: false,
      social_functions: "None",
      year_commitment_reduction: "1 year",
      recommender_date: "20/09/2026",
      committee_reason: "Yes\n\nGood umpire",
      committee_date: "28/09/2026",
    });
  });

  it("leaves the office-use fields blank", () => {
    expect(part.fields).not.toHaveProperty("tp_no");
    expect(part.fields).not.toHaveProperty("interview_month_year");
  });

  it("draws only the signatures there are", () => {
    expect(part.images?.map((i) => i.asset)).toEqual(["sponsor-signature"]);
  });

  it("never counts negative games when attendance is incomplete", () => {
    const p = playerStatementSpec({ ...statement, matchesTeamPlayed: 10, matchesPlayed: 12 }).parts[0];
    expect(p.kind === "template" && p.fields?.games_available_dnp).toBe("0");
    const q = playerStatementSpec({ ...statement, matchesTeamPlayed: null }).parts[0];
    expect(q.kind === "template" && q.fields?.games_available_dnp).toBe("");
  });
});

describe("u18Spec", () => {
  const facts: U18Facts = {
    surname: "McTestface",
    givenNames: "Junior",
    idNumber: "A123456(7)",
    dateOfBirth: "2010-05-17",
    nationality: "British",
    mobileNo: "+852 9123 4567",
    email: "junior@example.com",
    team: "Men's 5",
    jerseyNo: null,
    guardianSurname: "McTestface",
    guardianGivenNames: "Parent",
    guardianMobileNo: "+852 9876 5432",
    guardianEmail: "parent@example.com",
    signedAt: "2026-10-01T09:00:00Z",
  };
  const part = u18Spec(facts).parts[0];
  if (part.kind !== "template") throw new Error("expected a template part");
  const texts = part.text?.map((t) => t.text) ?? [];

  it("fills the table, skipping blank answers", () => {
    expect(texts).toContain("17/05/2010");
    expect(texts).toContain(`${CLUB_NAME} - Men's 5`);
    expect(part.text?.filter((t) => t.page === 1 && t.x === 357)).toHaveLength(12); // youth team and jersey left blank
  });

  it("names the guardian in both consents and under the signature, dated", () => {
    expect(texts.filter((t) => t === "Parent McTestface")).toHaveLength(3);
    expect(texts).toContain("01/10/2026");
    expect(part.images).toEqual([expect.objectContaining({ page: 2, asset: "guardian-signature" })]);
  });
});

describe("helpers", () => {
  it("formats dates the club's way", () => {
    expect(ddmmyyyy("2026-09-28T10:00:00Z")).toBe("28/09/2026");
    expect(ddmmyyyy(null)).toBe("");
  });

  it("asks for the Chinese font only when some text needs it", () => {
    const spec = (text: string) => ({ title: "T", parts: [{ kind: "template" as const, asset: "t", fields: { a: text } }] });
    expect(needsCjkFont(spec("Zoë O’Brien – “Coach”…"))).toBe(false);
    expect(needsCjkFont(spec("陳大文"))).toBe(true);
  });

  it("makes plain filenames", () => {
    expect(documentFilename("Player Statement Year 2", "Zoë O’Brien")).toBe("Player Statement Year 2 - Zoe OBrien.pdf");
    expect(documentFilename("", "")).toBe("Document.pdf");
  });
});
