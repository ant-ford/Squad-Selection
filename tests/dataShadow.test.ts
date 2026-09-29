import { afterEach, describe, expect, it, vi } from "vitest";
import { compare, resetShadowSummary, shadowed, shadowSummary } from "../worker/src/data/shadow";

afterEach(() => {
  resetShadowSummary();
  vi.restoreAllMocks();
});

describe("shadow comparison", () => {
  it("treats Airtable's missing fields and Postgres's empties as the same", () => {
    const airtable = [{ id: "rec1", active: undefined, cards: undefined, note: "" }];
    const supabase = [{ id: "rec1", active: false, cards: [], note: null }];
    expect(compare(airtable, supabase)).toMatchObject({ missing: 0, extra: 0, changed: 0 });
  });

  it("ignores row order and the order of id lists, but not their contents", () => {
    const a = [{ id: "a", coach: ["x", "y"] }, { id: "b", coach: [] }];
    expect(compare(a, [{ id: "b" }, { id: "a", coach: ["y", "x"] }]).changed).toBe(0);
    expect(compare(a, [{ id: "b" }, { id: "a", coach: ["y"] }])).toMatchObject({ changed: 1, fields: ["coach"], ids: ["a"] });
  });

  it("counts missing and extra rows, and names differing fields without their values", () => {
    const c = compare(
      [{ id: "a", surname: "Smith" }, { id: "b", surname: "Jones" }],
      [{ id: "a", surname: "Smyth" }, { id: "c", surname: "Brown" }],
    );
    expect(c).toEqual({ airtable: 2, supabase: 2, missing: 1, extra: 1, changed: 1, fields: ["surname"], ids: ["a", "b", "c"] });
    expect(JSON.stringify(c)).not.toMatch(/Smith|Smyth|Jones|Brown/);
  });

  it("treats trimmed text and formula errors as the import stores them, but not changed text", () => {
    const a = { id: "c", playerStatement: undefined, otherContributions: " \n", sportsBackground: "Played at uni\n", age: { specialValue: "NaN" } };
    expect(compare(a, { id: "c", otherContributions: null, sportsBackground: "Played at uni", age: null }).changed).toBe(0);
    expect(compare(a, { id: "c", sportsBackground: "Played at school" })).toMatchObject({ changed: 1, fields: ["sportsBackground"] });
  });

  it("compares files by name and link presence, ignoring Airtable's file metadata", () => {
    const a = { id: "p", applicationForm: [{ id: "att1", url: "https://airtable/f.pdf", filename: "form.pdf", size: 10, type: "application/pdf", thumbnails: {} }] };
    expect(compare(a, { id: "p", applicationForm: [{ url: "https://api/files/9?sig=z", filename: "form.pdf" }] }).changed).toBe(0);
    expect(compare(a, { id: "p", applicationForm: [{ url: "https://api/files/9?sig=z", filename: "other.pdf" }] }).changed).toBe(1);
    expect(compare(a, { id: "p", applicationForm: [] })).toMatchObject({ changed: 1, fields: ["applicationForm"] });
  });

  it("ignores the order of rows without ids, and skips Fillout form links", () => {
    const a = [{ office: "sectionChair", memberIds: ["x"] }, { office: "sectionCaptain", memberIds: ["y"] }];
    expect(compare(a, [...a].reverse()).changed).toBe(0);
    expect(compare({ id: "p", waiversFormUrl: "https://forms.fillout.com/t/x" }, { id: "p", waiversFormUrl: "" }).changed).toBe(0);
  });

  it("compares photo links by presence only, and skips the derived ranks", () => {
    const a = { id: "p", photo: "https://airtable/x.jpg", teamRank: 3 };
    expect(compare(a, { id: "p", photo: "https://api/files/1?sig=z" }).changed).toBe(0);
    expect(compare(a, { id: "p" })).toMatchObject({ changed: 1, fields: ["photo"] });
  });
});

describe("shadowed repositories", () => {
  it("serves the primary result, then compares reads with the shadow in the background", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = { listActive: vi.fn(async () => [{ id: "a", surname: "X" }]), update: vi.fn(async () => {}) };
    const shadow = { listActive: vi.fn(async () => [{ id: "a", surname: "Y" }]), update: vi.fn(async () => {}) };
    const repo = shadowed("people", primary, () => shadow);

    expect(await repo.listActive()).toEqual([{ id: "a", surname: "X" }]);
    await vi.waitFor(() => expect(shadowSummary()["people.listActive"]?.calls).toBe(1));
    expect(shadowSummary()["people.listActive"]).toMatchObject({ withDifferences: 1, failed: 0, lastDifference: { fields: ["surname"] } });
    expect(warn.mock.calls[0][0]).toMatch(/^shadow .*"fields":\["surname"\]/);
    expect(warn.mock.calls[0][0]).not.toMatch(/"X"|"Y"/);
  });

  it("never shadows a write", async () => {
    const primary = { update: vi.fn(async () => {}) };
    const shadow = { update: vi.fn(async () => {}) };
    await shadowed("people", primary, () => shadow).update();
    expect(primary.update).toHaveBeenCalledOnce();
    expect(shadow.update).not.toHaveBeenCalled();
  });

  it("counts a failing shadow read without failing the request", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = shadowed("teams", { listAll: async () => [] }, () => ({ listAll: async () => { throw new Error("boom"); } }));
    expect(await repo.listAll()).toEqual([]);
    await vi.waitFor(() => expect(shadowSummary()["teams.listAll"]?.failed).toBe(1));
  });
});
