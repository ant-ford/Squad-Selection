import { describe, it, expect } from "vitest";
import {
  emailsAhead,
  outcomesThisSeason,
  participationBand,
  reviewSponsorLoad,
  reviewWaits,
  stepTimes,
  type ReviewFact,
} from "../shared/statementInsights";

const TODAY = "2026-09-26";

const fact = (over: Partial<ReviewFact>): ReviewFact => ({
  name: "Pat Player",
  stage: "Not Started",
  days: null,
  notifyRequested: false,
  ...over,
});

describe("1. review emails coming up", () => {
  it("counts automatic emails by month for six months, and those already due", () => {
    const ahead = emailsAhead(
      [
        fact({ autoNoticeOn: "2026-10-01" }),
        fact({ autoNoticeOn: "2026-10-19" }),
        fact({ autoNoticeOn: "2027-01-20" }),
        fact({ autoNoticeOn: "2027-03-01" }), // seven months out: beyond the chart
        fact({ autoNoticeOn: "2026-09-10" }), // inside the 60-day window already
        fact({ autoNoticeOn: "2026-06-01" }), // the period has ended
        fact({ autoNoticeOn: "2026-10-05", notifyRequested: true }), // already asked for
        fact({ stage: "Notified Member", autoNoticeOn: "2026-10-05" }),
      ],
      TODAY,
    );
    expect(ahead.dueNow).toBe(2);
    expect(ahead.byMonth).toEqual([
      { month: "2026-09", count: 0 },
      { month: "2026-10", count: 2 },
      { month: "2026-11", count: 0 },
      { month: "2026-12", count: 0 },
      { month: "2027-01", count: 1 },
      { month: "2027-02", count: 0 },
    ]);
    expect(ahead.total).toBe(3);
  });
});

describe("2. where reviews get stuck", () => {
  it("gives each waiting stage its count, median, over-30s and longest", () => {
    const waits = reviewWaits([
      fact({ stage: "Notified Member", name: "Justin", days: 80 }),
      fact({ stage: "Notified Member", name: "Ralph", days: 50 }),
      fact({ stage: "Notified Member", name: "Nilesh", days: 20 }),
      fact({ stage: "Member Submitted (with Sponsor)", name: "Max", days: 24 }),
    ]);
    expect(waits).toEqual([
      { stage: "Notified Member", count: 3, medianDays: 50, over30: 2, longest: { name: "Justin", days: 80 } },
      { stage: "Member Submitted (with Sponsor)", count: 1, medianDays: 24, over30: 0, longest: { name: "Max", days: 24 } },
      { stage: "Sponsor Submitted (with Membership Officer)", count: 0, medianDays: null, over30: 0, longest: null },
    ]);
  });

  it("times the sponsor's and the officer's finished steps from the submission dates", () => {
    expect(
      stepTimes([
        fact({ stage: "Complete", autoNoticeOn: "2026-06-01", memberSubmittedOn: "2026-06-11", sponsorSubmittedOn: "2026-06-15", officerSubmittedOn: "2026-06-16" }),
        fact({ stage: "Complete", autoNoticeOn: "2026-06-10", memberSubmittedOn: "2026-06-30", sponsorSubmittedOn: "2026-07-10", officerSubmittedOn: "2026-07-12" }),
        // Still with the sponsor: no sponsor time yet.
        fact({ stage: "Member Submitted (with Sponsor)", memberSubmittedOn: "2026-09-20" }),
      ]),
    ).toEqual([
      { step: "Sponsor's section", medianDays: 7, reviews: 2 },
      { step: "Membership Officer's review", medianDays: 2, reviews: 2 },
    ]);
  });
});

describe("3. sponsor load", () => {
  it("counts the reviews waiting on each sponsor, most first", () => {
    expect(
      reviewSponsorLoad([
        fact({ stage: "Member Submitted (with Sponsor)", sponsor: "Jason" }),
        fact({ stage: "Member Submitted (with Sponsor)", sponsor: "Oli" }),
        fact({ stage: "Member Submitted (with Sponsor)", sponsor: "Oli" }),
        fact({ stage: "Complete", sponsor: "Geoff" }), // done, not waiting
        fact({ sponsor: "Geoff" }), // Not Started
      ]),
    ).toEqual([
      { sponsor: "Oli", waiting: 2 },
      { sponsor: "Jason", waiting: 1 },
    ]);
  });
});

describe("4. outcomes this season", () => {
  it("counts only reviews completed since 1 July, in the fields' own order", () => {
    const out = outcomesThisSeason(
      [
        fact({ stage: "Complete", officerSubmittedOn: "2026-07-20", recommendedReduction: "None", matchesPlayed: 14, matchesTeamPlayed: 17, practices: "Moderate 50-70%", gamesUmpired: "0" }),
        fact({ stage: "Complete", officerSubmittedOn: "2026-08-02", recommendedReduction: "1 year", matchesPlayed: 5, matchesTeamPlayed: 16, practices: "Hardly Ever <50%", gamesUmpired: "5+" }),
        fact({ stage: "Complete", officerSubmittedOn: "2026-09-01", recommendedReduction: "None", matchesPlayed: 9, matchesTeamPlayed: 15, gamesUmpired: "0" }),
        fact({ stage: "Complete", officerSubmittedOn: "2026-06-20", recommendedReduction: "2 years" }), // last season
        fact({ stage: "Sponsor Submitted (with Membership Officer)", recommendedReduction: "2 years" }),
      ],
      TODAY,
    );
    expect(out.completed).toBe(3);
    expect(out.reductions).toEqual([
      { label: "None", count: 2 },
      { label: "1 year", count: 1 },
    ]);
    expect(out.participation).toEqual([
      { label: "70% or more", count: 1 },
      { label: "50–69%", count: 1 },
      { label: "Under 50%", count: 1 },
    ]);
    expect(out.practices).toEqual([
      { label: "Moderate 50-70%", count: 1 },
      { label: "Hardly Ever <50%", count: 1 },
      { label: "Not recorded", count: 1 },
    ]);
    expect(out.umpired).toEqual([
      { label: "0", count: 2 },
      { label: "5+", count: 1 },
    ]);
  });

  it("bands participation by share of the team's matches, and leaves it blank without them", () => {
    expect(participationBand(7, 10)).toBe("70% or more");
    expect(participationBand(5, 10)).toBe("50–69%");
    expect(participationBand(4, 10)).toBe("Under 50%");
    expect(participationBand(4, 0)).toBeUndefined();
    expect(participationBand(undefined, 10)).toBeUndefined();
  });
});
