import { describe, expect, it } from "vitest";
import { ASSET, applicationSpec, mmyyyy, wrap, type ApplicationFacts } from "../worker/src/pdf/applicationSpec";

const address = { flatType: "Flat", unit: "12B", floor: "23", block: "2", building: "Test Mansion", street: "1 Sample Road", district: "Wan Chai", region: "Hong Kong" };
const blankAddress = { flatType: null, unit: null, floor: null, block: null, building: null, street: null, district: null, region: null };
const work = { company: "Example Ltd", address: blankAddress, position: null, natureOfBusiness: null, officeTel: null, officeEmail: null };

function facts(over: Partial<ApplicationFacts> = {}): ApplicationFacts {
  return {
    submittedAt: "2026-10-01T09:00:00Z",
    categoryType: "Junior (under 21)",
    playerCoach: ["Player", "Coach"],
    memberType: null,
    membershipNo: null,
    applicant: {
      salutation: "Mr", surname: "McTestface", givenNames: "Testy", chineseName: "陳大文", gender: "Male", dateOfBirth: "2006-05-17",
      idNumber: "A123456(7)", nationality: "British", email: "testy@example.com", mobileNo: "+852 9123 4567",
      placeOfBirth: "London", arrivedOn: "2015-08-01", maritalStatus: "Single", homeTel: null, home: address, work,
    },
    relatives: [],
    qualifications: ["Diploma / Certificate / Associate Degree"],
    clubs: [],
    sportsBackground: "County hockey",
    personalInterest: null,
    billing: ["Office Email"],
    correspondence: ["Spouse Personal Email"],
    spouse: null,
    children: [],
    trials: [
      { date: "2026-09-05", types: ["Training", "Playing"], division: "Division 2" },
      { date: "2026-09-12", types: ["Coaching"], division: null },
    ],
    team: "Men's 3",
    position: "Midfield",
    sponsorAssessment: { sportsBackground: "Strong", trainingComments: "Keen", level: "Division 2" },
    sponsor: { name: "Sam Sponsor", designation: "Captain", membershipNo: "S1", signedAt: "2026-10-02" },
    chair: { name: "Chris Chair", designation: "Chairperson", membershipNo: "C1", signedAt: "2026-10-03" },
    officer: { name: "Morgan Officer", designation: "Membership Officer", membershipNo: "O1", signedAt: "2026-10-04" },
    bank: null,
    u18: null,
    assets: [ASSET.sam, ASSET.levy, ASSET.pledge, ASSET.signature, ASSET.photo, ASSET.sponsorSignature],
    supporting: [],
    ...over,
  };
}

const sam = (f: ApplicationFacts) => {
  const part = applicationSpec(f).parts[0];
  if (part.kind !== "template" || part.asset !== ASSET.sam) throw new Error("expected the application first");
  return part;
};

describe("applicationSpec", () => {
  it("fills the applicant's details and leaves office-use fields blank", () => {
    const fields = sam(facts()).fields!;
    expect(fields).toMatchObject({
      Hockey: true,
      "Junior under 21": true,
      Player: true,
      Coach: true,
      salutation: "Mr",
      "Principal Member Surname": "McTestface",
      "Principal Member Chinese Name": "陳大文",
      "Principal Member DOB": "17/05/2006",
      "Principal Member Age": "20",
      Male: true,
      Single: true,
      "Principle Member Arrival Date": "08/2015",
      "Principal Member Home": "Flat 12B",
      "Principal Member Home Flat": "23",
      "Principal Member Home District": "Wan Chai, Hong Kong",
      toggle_2: true, // Diploma
      toggle_11: true, // billing: main cardholder's office email
      "Spouse  Partner Personal Email_2": true,
      "Applicant Name": "Testy McTestface",
      "Principal Member's Signature Date": "01/10/2026",
    });
    for (const office of ["A/C No", "TP Period From", "Commitment Period From", "Office use - Category", "Received Application Date", "Membership No"]) {
      expect(fields).not.toHaveProperty([office]);
    }
  });

  it("records trials and the three signers on page 7", () => {
    const fields = sam(facts()).fields!;
    expect(fields).toMatchObject({
      "First Attendance Date": "05/09/2026",
      "First Training 1": "Yes",
      "First Playing": "Division 2",
      "Sub Attendance Date 1": "12/09/2026",
      "Sub Coaching 1": "Yes",
      "Applicant Team": "Men's 3",
      Level: "Division 2",
      "Captain/Coach Name": "Sam Sponsor",
      "Captain/Coach Sign Date": "02/10/2026",
      "Section Member Name 1": "Chris Chair",
      "Section Member Name 2": "Morgan Officer",
      "Section Member Signature Date 2": "04/10/2026",
    });
    expect(fields).not.toHaveProperty(["First Coaching 1"]);
  });

  it("draws only the images there are, including page 5's photo box", () => {
    const part = sam(facts());
    expect(part.fieldImages).toEqual({
      "Principal Member's Photo_af_image": ASSET.photo,
      "Principal Member's Signature": ASSET.signature,
      "Signature of the Applicant 1": ASSET.signature,
      "Signature of the Applicant 3": ASSET.signature,
      "Captain/Coach Signature": ASSET.sponsorSignature,
    });
    expect(part.images).toEqual([expect.objectContaining({ page: 5, asset: ASSET.photo })]);
  });

  it("fills the spouse and children", () => {
    const spouse = { ...facts().applicant, salutation: "Mrs", givenNames: "Partner", gender: "Female", dateOfBirth: "1991-02-03", weddingAnniversary: "2019-06-15", work };
    const child = { salutation: null, surname: "McTestface", givenNames: "Kid", chineseName: null, gender: "F", dateOfBirth: "2014-04-04", idNumber: null, nationality: null, email: null, mobileNo: null };
    const fields = sam(facts({ spouse, children: [child] })).fields!;
    expect(fields).toMatchObject({
      salutation_2: "Mrs_2",
      Gender: "Female_2",
      "Spouse Given Name": "Partner",
      "Spouse Wedding Anniversary": "15/06/2019",
      "Children 1 Given Name": "Kid",
      "Children 1 Gender": "F",
    });
  });

  it("fills the Direct Debit only when there are bank details, leaving the club's payment limit alone", () => {
    expect(sam(facts()).text).toEqual([]);
    const bank = { payer: "Applicant", bankName: "HSBC", bankCode: "004", branchNo: "123", accountNo: "456789001", contactNo: null, limit: "Each Payment", limitAmount: 5000, accountName: "Testy McTestface" };
    const text = sam(facts({ bank, assets: [...facts().assets, ASSET.accountSignature] })).text!;
    expect(text.every((t) => t.page === 10)).toBe(true);
    expect(text.map((t) => t.text)).toEqual(expect.arrayContaining(["TESTY MCTESTFACE", "HSBC, branch 123", "4", "5", "+852 9123 4567"]));
    expect(text.map((t) => t.text)).not.toContain("5,000");
    expect(sam(facts({ bank, assets: [...facts().assets, ASSET.accountSignature] })).images).toContainEqual(expect.objectContaining({ page: 10, asset: ASSET.accountSignature }));
  });

  it("adds the levy form, the pledge, the U18 form when under 18, and the supporting documents, in that order", () => {
    const u18 = {
      surname: "McTestface", givenNames: "Testy", idNumber: "A123456(7)", dateOfBirth: "2010-05-17", nationality: "British", mobileNo: "", email: "",
      team: "", jerseyNo: null, guardianSurname: "McTestface", guardianGivenNames: "Parent", guardianMobileNo: "", guardianEmail: "", signedAt: "2026-10-01T09:00:00Z",
    };
    const parts = applicationSpec(facts({ u18, supporting: [{ asset: "doc-1", caption: "Testy McTestface: HKID", kind: "image" }] })).parts;
    expect(parts.map((p) => p.asset)).toEqual([ASSET.sam, ASSET.levy, ASSET.pledge, ASSET.u18, "doc-1"]);
    const levy = parts[1];
    expect(levy.kind === "template" && levy.fields).toMatchObject({ "Member Name": "Testy McTestface", "Hockey Section 70month": true, Main: true, Date: "01/10/2026" });
    expect(levy.kind === "template" && levy.fieldImages).toEqual({ Signature: ASSET.signature });
    const pledge = parts[2];
    expect(pledge.kind === "template" && pledge.text?.map((t) => t.text)).toEqual(["Testy McTestface", "01/10/2026"]);
  });
});

describe("helpers", () => {
  it("wraps text over lines by word, the last line taking the rest", () => {
    expect(wrap("one two three four", [7, 7, 7])).toEqual(["one two", "three", "four"]);
    expect(wrap("one two three four five six", [7, 7])).toEqual(["one two", "three four five six"]);
    expect(wrap(null, [5, 5])).toEqual(["", ""]);
  });

  it("formats month and year", () => {
    expect(mmyyyy("2015-08-01")).toBe("08/2015");
    expect(mmyyyy(null)).toBe("");
  });
});
