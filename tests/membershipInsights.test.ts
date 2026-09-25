import { describe, it, expect } from "vitest";
import {
  applicationsIn,
  breakdown,
  funnel,
  joinedIn,
  median,
  monthly,
  monthsBetween,
  nowSummary,
  periodRanges,
  pipelineByTeam,
  seasonStartYear,
  sponsorLoad,
  waitsByStage,
  type InsightFact,
} from "../shared/membershipInsights";

const fact = (o: Partial<InsightFact> & Pick<InsightFact, "column">): InsightFact => ({
  name: "Someone",
  stage: o.column,
  days: null,
  ...o,
});

const TODAY = "2026-09-25";

describe("periods", () => {
  it("starts the season in July", () => {
    expect(seasonStartYear("2026-06-30")).toBe(2025);
    expect(seasonStartYear("2026-07-01")).toBe(2026);
  });

  it("compares this season so far with the same point last season", () => {
    expect(periodRanges("season", TODAY)).toEqual({
      current: { from: "2026-07-01", to: "2026-09-25" },
      previous: { from: "2025-07-01", to: "2025-09-25" },
      previousLabel: "same point last season",
    });
  });

  it("compares last season with the one before it", () => {
    expect(periodRanges("last-season", TODAY)).toMatchObject({
      current: { from: "2025-07-01", to: "2026-06-30" },
      previous: { from: "2024-07-01", to: "2025-06-30" },
      previousLabel: "season 2024-25",
    });
  });

  it("makes the last 12 months exactly 365 days, and the year before likewise", () => {
    expect(periodRanges("12m", TODAY)).toMatchObject({
      current: { from: "2025-09-26", to: "2026-09-25" },
      previous: { from: "2024-09-26", to: "2025-09-25" },
    });
  });

  it("has nothing to compare all time with", () => {
    expect(periodRanges("all", TODAY).previous).toBeNull();
  });

  it("maps 29 February to 28 February a year earlier", () => {
    expect(periodRanges("season", "2028-02-29").previous?.to).toBe("2027-02-28");
  });
});

describe("applications and joiners", () => {
  const facts = [
    fact({ column: "1. Trial Application", appliedOn: "2026-08-01" }),
    fact({ column: "Accepted", appliedOn: "2026-05-01", joinDate: "2026-08-15" }),
    fact({ column: "Temporary", appliedOn: "2026-08-02" }), // not the membership process
    fact({ column: "Needs fixing", appliedOn: "2026-08-03" }), // bad data
    fact({ column: "Rejected", appliedOn: "2025-08-01" }),
  ];
  const season = periodRanges("season", TODAY).current;

  it("counts applications made in the period, leaving out Temporary and bad stages", () => {
    expect(applicationsIn(facts, season)).toHaveLength(1);
  });

  it("counts joiners by Join Date, not by when they applied", () => {
    expect(joinedIn(facts, season)).toHaveLength(1);
  });
});

describe("funnel", () => {
  it("counts how many reached at least each stage, judged by where they are now", () => {
    const facts = [
      fact({ column: "1. Trial Application", appliedOn: "2026-08-01" }),
      fact({ column: "3. Club Application (Signed)", appliedOn: "2026-08-01" }),
      fact({ column: "6. Membership Officer (Signed)", appliedOn: "2026-08-01" }),
      fact({ column: "Accepted", appliedOn: "2026-08-01", joinDate: "2026-09-01" }),
      // Parked: known only to have applied.
      fact({ column: "Rejected", appliedOn: "2026-08-01" }),
      // Applied before the period.
      fact({ column: "Accepted", appliedOn: "2026-03-01" }),
    ];
    const counts = funnel(facts, periodRanges("season", TODAY).current).map((s) => s.reached);
    expect(counts).toEqual([5, 3, 3, 2, 2, 2, 1]);
  });
});

describe("right now", () => {
  const facts = [
    fact({ column: "2. Section Captain Invitation", days: 10, name: "A" }),
    fact({ column: "2. Section Captain Invitation", days: 40, name: "B" }),
    fact({ column: "6. Membership Officer (Signed)", days: 31, name: "C" }),
    fact({ column: "6. Membership Officer (Signed)", days: null, name: "D" }),
    fact({ column: "Accepted", days: 100 }), // done: not waiting
    fact({ column: "Rejected", days: 200 }), // parked: not in the pipeline
  ];

  it("summarises the open applications", () => {
    expect(nowSummary(facts)).toEqual({ inPipeline: 4, readyToApprove: 2, over30: 2, medianWait: 31 });
  });

  it("gives each open stage its count, median wait and longest wait", () => {
    const waits = waitsByStage(facts);
    expect(waits).toHaveLength(6);
    expect(waits[1]).toEqual({
      stage: "2. Section Captain Invitation",
      count: 2,
      medianDays: 25,
      longest: { name: "B", days: 40 },
    });
    expect(waits[5]).toMatchObject({ count: 2, medianDays: 31, longest: { name: "C", days: 31 } });
    expect(waits[0]).toEqual({ stage: "1. Trial Application", count: 0, medianDays: null, longest: null });
  });

  it("groups open applications by team", () => {
    const byTeam = pipelineByTeam([
      fact({ column: "1. Trial Application", team: "HKFC C" }),
      fact({ column: "4. Sponsor (Signed)", team: "HKFC C" }),
      fact({ column: "5. Chairman (Signed)" }),
      fact({ column: "Accepted", team: "HKFC C" }),
    ]);
    expect(byTeam.get("HKFC C")).toHaveLength(2);
    expect(byTeam.get("No team")).toHaveLength(1);
  });

  it("puts the sponsors holding things up first", () => {
    expect(
      sponsorLoad([
        fact({ column: "3. Club Application (Signed)", sponsor: "Chris" }),
        fact({ column: "3. Club Application (Signed)", sponsor: "Chris" }),
        fact({ column: "5. Chairman (Signed)", sponsor: "Dee" }),
        fact({ column: "1. Trial Application", sponsor: "Dee" }),
        fact({ column: "5. Chairman (Signed)", sponsor: "Eve" }),
        fact({ column: "Accepted", sponsor: "Eve" }),
      ]),
    ).toEqual([
      { sponsor: "Chris", open: 2, waitingOnThem: 2 },
      { sponsor: "Dee", open: 2, waitingOnThem: 0 },
      { sponsor: "Eve", open: 1, waitingOnThem: 0 },
    ]);
  });
});

describe("monthly", () => {
  it("lists every month of the period up to this one, with zeros", () => {
    const rows = monthly(
      [
        fact({ column: "1. Trial Application", appliedOn: "2026-07-03" }),
        fact({ column: "1. Trial Application", appliedOn: "2026-07-20" }),
        fact({ column: "1. Trial Application", appliedOn: "2026-09-01" }),
      ],
      periodRanges("season", TODAY).current,
      TODAY,
      "applied",
    );
    expect(rows).toEqual([
      { month: "2026-07", count: 2 },
      { month: "2026-08", count: 0 },
      { month: "2026-09", count: 1 },
    ]);
  });

  it("starts all time at the first month with data, never more than ten years back", () => {
    const rows = monthly(
      [
        fact({ column: "Accepted", appliedOn: "2001-01-01", joinDate: "2001-02-01" }),
        fact({ column: "Accepted", appliedOn: "2026-01-01", joinDate: "2026-02-01" }),
      ],
      periodRanges("all", TODAY).current,
      TODAY,
      "joined",
    );
    expect(rows[0].month).toBe("2016-09");
    expect(rows[rows.length - 1].month).toBe("2026-09");
  });

  it("walks months across a year end", () => {
    expect(monthsBetween("2025-11-15", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("helpers", () => {
  it("takes the middle value, rounding an even-count median", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2])).toBe(2); // 1.5 rounds up
  });

  it("breaks rows down by an attribute, blanks as Not set", () => {
    expect(
      breakdown(
        [
          fact({ column: "Accepted", playingPosition: "Defender" }),
          fact({ column: "Accepted", playingPosition: "Defender" }),
          fact({ column: "Accepted" }),
        ],
        "playingPosition",
      ),
    ).toEqual([
      { label: "Defender", count: 2 },
      { label: "Not set", count: 1 },
    ]);
  });
});
