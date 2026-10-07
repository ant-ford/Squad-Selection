import { describe, expect, it } from "vitest";
import { csvCell } from "../shared/csv";
import { answersCsv, chargesCsv, type Guest, type PayerCharge, type ResponseStatus } from "../shared/events";
import { topUpCsvText } from "../worker/src/kit";
import type { KitSizes } from "../shared/kit";

// The builders as they were before the formula guard, to show ordinary text comes out byte for byte the same.
const oldCell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const oldLines = (rows: (string | number | null)[][]) => rows.map((r) => r.map(oldCell).join(",")).join("\r\n");
function oldChargesCsv(title: string, date: string, payers: PayerCharge[]) {
  const rows: (string | number | null)[][] = [["Name", "Membership no.", "Amount (HK$)", "For", "Event", "Date"]];
  for (const p of payers.filter((x) => x.total > 0)) {
    const what = p.lines.map((l) => (l.what === "Member" ? l.name : `${l.name} (${l.what.toLowerCase()})`)).join("; ");
    rows.push([p.name, p.membershipNo ?? "", p.total.toFixed(2), what, title, date]);
  }
  return oldLines(rows);
}
type AnswerRow = { name: string; status: ResponseStatus; guests: Guest[]; answers: Record<string, string>; canHelp: boolean; notes: string | null };
const LABEL: Record<ResponseStatus, string> = { going: "Going", maybe: "Maybe", not_going: "Not going" };
function oldAnswersCsv(questions: { key: string; label: string }[], rows: AnswerRow[]) {
  const out: string[][] = [["Name", "Answer", "Guest of", ...questions.map((q) => q.label), "Can help", "Note"]];
  for (const r of rows.filter((x) => x.status !== "not_going")) {
    out.push([r.name, LABEL[r.status], "", ...questions.map((q) => r.answers[q.key] ?? ""), r.canHelp ? "Yes" : "", r.notes ?? ""]);
    for (const g of r.guests) out.push([g.name, `Guest (${g.age})`, r.name, ...questions.map((q) => (q.key === "dietary" ? g.dietary ?? "" : "")), "", ""]);
  }
  return oldLines(out);
}
type TopUp = Parameters<typeof topUpCsvText>[0][number];
function oldTopUp(need: TopUp[]) {
  const header = ["Name", "Status", "Shirt No.", "Socks Size", "Shirt Size", "Shorts Size", "Goalie Smock Style", "Goalie Smock Size", "Team"];
  const lines = need.map((p) => [p.name, p.status, p.shirtNo, p.sizes.socks, p.sizes.shirt, p.sizes.shorts, p.sizes.goalieSmockStyle, p.sizes.goalieSmock, p.team].map(oldCell).join(","));
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

const sizes = (more: Partial<KitSizes> = {}): KitSizes => ({ shirt: null, shorts: null, socks: null, goalieSmock: null, goalieSmockStyle: null, ...more });
const QS = [{ key: "dietary", label: "Dietary requirements" }, { key: "q1", label: "Arriving by, roughly" }];

describe("CSV downloads made from members' own text", () => {
  describe("ordinary text is unchanged", () => {
    const payers: PayerCharge[] = [
      { payerId: "a", name: "Dave Smith", membershipNo: "M1", total: 750, lines: [{ name: "Dave Smith", what: "Member", amount: 350 }, { name: "Jane, Smith", what: "Adult guest", amount: 400 }] },
      { payerId: "b", name: 'Bob "The Wall" O\'Neill', membershipNo: null, total: 12.5, lines: [{ name: "Bob", what: "Member", amount: 12.5 }] },
      { payerId: "c", name: "Nobody", membershipNo: null, total: 0, lines: [] },
    ];
    const answers: AnswerRow[] = [
      { name: "Dave Smith", status: "going", guests: [{ name: "Jane", age: "adult", dietary: "No nuts, no shellfish" }], answers: { dietary: "Vegetarian", q1: "7pm" }, canHelp: true, notes: "Bringing\nthe cake" },
      { name: "Kim Ho 何", status: "maybe", guests: [{ name: "Leo", age: "child" }], answers: { q1: 'About "8"' }, canHelp: false, notes: null },
      { name: "Ann Lee", status: "not_going", guests: [], answers: {}, canHelp: false, notes: null },
    ];
    const need: TopUp[] = [
      { name: "Bo Two", status: "Applicant", shirtNo: 31, sizes: sizes({ shirt: "L", socks: "7-11" }), team: "HKFC B" },
      { name: "Smith, Al", status: "Member", shirtNo: 7, sizes: sizes({ goalieSmockStyle: 'Long "pro"', goalieSmock: "XL" }), team: "HKFC A" },
    ];

    it("treasurer's list", () => {
      expect(chargesCsv("Christmas Party, 2026", "11 Dec 2026", payers)).toBe(oldChargesCsv("Christmas Party, 2026", "11 Dec 2026", payers));
    });
    it("answers", () => {
      expect(answersCsv({ questions: QS }, answers)).toBe(oldAnswersCsv(QS, answers));
    });
    it("kit top-up", () => {
      expect(topUpCsvText(need)).toBe(oldTopUp(need));
    });
  });

  it("keeps formula-looking text in the treasurer's list as text, and amounts as numbers", () => {
    const csv = chargesCsv("@SUM(A1:A9)", "11 Dec 2026", [
      { payerId: "a", name: '=HYPERLINK("http://evil.example","Pay here")', membershipNo: "+1", total: 50, lines: [{ name: "-2 Guest", what: "Adult guest", amount: 50 }] },
    ]);
    expect(csv.split("\r\n")[1]).toBe(`"'=HYPERLINK(""http://evil.example"",""Pay here"")",'+1,50.00,'-2 Guest (adult guest),'@SUM(A1:A9),11 Dec 2026`);
  });

  it("keeps formula-looking answers and notes as text, with commas, quotes and new lines intact", () => {
    const csv = answersCsv({ questions: QS }, [
      { name: "\tTab Start", status: "going", guests: [{ name: "=1+1", age: "adult", dietary: "+vegan" }], answers: { dietary: "-2", q1: "@noon, maybe" }, canHelp: true, notes: 'Says "hi"\r\nthen leaves' },
      { name: "Ann", status: "going", guests: [], answers: { q1: "\rCR start" }, canHelp: false, notes: "3" },
    ]);
    expect(csv.split("\r\n").length).toBeGreaterThan(3); // a quoted note's own CRLF stays inside the cell
    expect(csv).toBe(
      [
        "Name,Answer,Guest of,Dietary requirements,\"Arriving by, roughly\",Can help,Note",
        `'\tTab Start,Going,,'-2,"'@noon, maybe",Yes,"Says ""hi""\r\nthen leaves"`,
        `'=1+1,Guest (adult),'\tTab Start,'+vegan,,,`,
        `Ann,Going,,,"'\rCR start",,3`,
      ].join("\r\n"),
    );
  });

  it("keeps formula-looking names in the kit top-up as text, and shirt numbers as numbers", () => {
    const csv = topUpCsvText([{ name: "@Al", status: "-Member", shirtNo: 9, sizes: sizes({ shirt: "=L", shorts: "M" }), team: "+HKFC A" }]);
    expect(csv).toBe(
      "Name,Status,Shirt No.,Socks Size,Shirt Size,Shorts Size,Goalie Smock Style,Goalie Smock Size,Team\r\n'@Al,'-Member,9,,'=L,M,,,'+HKFC A\r\n",
    );
  });
});

// Security review, 7 Oct 2026: the forms the first guard missed.
describe("csvCell", () => {
  it("escapes a formula after leading spaces or a byte-order mark, a leading LF, and full-width signs", () => {
    for (const v of [" =1+1", "  @SUM(A1)", "\uFEFF=1", "\nX", "\uFF1D1+1", "\uFF0BA", "\uFF0D2", "\uFF20x"]) {
      expect(csvCell(v).replace(/^"/, "")).toMatch(/^'/);
    }
  });

  it("leaves ordinary text alone, a dash or sign inside it included", () => {
    for (const v of ["Dave Smith", "Smith-Jones", "a = b", " Lee", "7-11", "100%"]) expect(csvCell(v)).toBe(v);
  });
});
