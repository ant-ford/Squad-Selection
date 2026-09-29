import { describe, expect, it } from "vitest";
import { toRow } from "../worker/src/data/rows";

const MAP = { stage: "Applicant Stage", sponsor: "Sponsored By Sponsor", photo: "Photo", age: "Age" } as const;

describe("toRow", () => {
  it("keys a record by the map's keys and keeps Airtable's value shapes", () => {
    const record = {
      id: "recAAAAAAAAAAAAAA",
      fields: {
        "Applicant Stage": "3. Club Application (Signed)",
        "Sponsored By Sponsor": ["recBBBBBBBBBBBBBB"],
        Photo: [{ url: "https://x/p.jpg", filename: "p.jpg" }],
        Age: 0,
        "Not In The Map": "ignored",
      },
    };
    expect(toRow(record, MAP)).toEqual({
      id: "recAAAAAAAAAAAAAA",
      stage: "3. Club Application (Signed)",
      sponsor: ["recBBBBBBBBBBBBBB"],
      photo: [{ url: "https://x/p.jpg", filename: "p.jpg" }],
      age: 0,
    });
  });

  it("leaves out fields the record does not carry, and copes with no fields at all", () => {
    const row = toRow({ id: "recCCCCCCCCCCCCCC", fields: { Age: 30 } }, MAP);
    expect(Object.keys(row).sort()).toEqual(["age", "id"]);
    expect(toRow({ id: "recDDDDDDDDDDDDDD" }, MAP)).toEqual({ id: "recDDDDDDDDDDDDDD" });
  });
});
