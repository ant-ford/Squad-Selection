import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript import script
import { seasonPlanRow } from "../scripts/migration/mapping.mjs";

const answers = { "Playing Availability": ["Available for all matches (90%+)"], "Playing Preference": "Play in the highest team I am selected for." };

describe("importing season plans", () => {
  it("imports only answers given this season (since 1 July, Hong Kong time) or with a current application", () => {
    expect(seasonPlanRow({ ...answers, "Last Submission: Profile Update": "2026-07-02T03:00:00.000Z" })).toMatchObject({ season: "2026-2027" });
    // 30 June 17:00 UTC is 1 July 01:00 in Hong Kong.
    expect(seasonPlanRow({ ...answers, "Last Submission: Profile Update": "2026-06-30T17:00:00.000Z" })).not.toBeNull();
    expect(seasonPlanRow({ ...answers, "Last Submission: Profile Update": "2026-06-30T15:00:00.000Z" })).toBeNull();
    expect(seasonPlanRow({ ...answers })).toBeNull();
    expect(seasonPlanRow({ ...answers, Status: "Applicant", "Applicant Stage": "4. Sponsor (Signed)" })).not.toBeNull();
    expect(seasonPlanRow({ ...answers, Status: "Applicant", "Applicant Stage": "Rejected" })).toBeNull();
    expect(seasonPlanRow({ "Last Submission: Profile Update": "2026-08-01T00:00:00.000Z" })).toBeNull();
  });
});
