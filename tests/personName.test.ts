import { describe, it, expect } from "vitest";
import { firstName, fullName } from "../shared/personName";

describe("firstName", () => {
  it("uses the preferred name, else the given names", () => {
    expect(firstName({ preferred_name: "Jim", given_names: "James Robert", surname: "Smith" })).toBe("Jim");
    expect(firstName({ preferred_name: null, given_names: "James Robert", surname: "Smith" })).toBe("James Robert");
    expect(firstName({ preferredName: "Jim", givenNames: "James", surname: "Smith" })).toBe("Jim");
    expect(firstName({ givenNames: "James", surname: "Smith" })).toBe("James");
  });

  it("treats an empty string as not set", () => {
    expect(firstName({ preferred_name: "", given_names: "James", surname: null })).toBe("James");
    expect(firstName({ preferredName: "", givenNames: "", surname: "Smith" })).toBe("");
  });

  it("is empty for no person or no first name, never the surname", () => {
    expect(firstName(null)).toBe("");
    expect(firstName(undefined)).toBe("");
    expect(firstName({ preferred_name: null, given_names: null, surname: "Smith" })).toBe("");
  });

  it("trims nothing", () => {
    expect(firstName({ preferred_name: " ", given_names: "James" })).toBe(" ");
    expect(firstName({ preferred_name: " Jim ", given_names: "James" })).toBe(" Jim ");
  });
});

describe("fullName", () => {
  it("joins the first name and surname with one space", () => {
    expect(fullName({ preferred_name: "Jim", given_names: "James", surname: "Smith" })).toBe("Jim Smith");
    expect(fullName({ preferred_name: null, given_names: "James Robert", surname: "Smith" })).toBe("James Robert Smith");
    expect(fullName({ preferredName: "Jim", givenNames: "James", surname: "Smith" })).toBe("Jim Smith");
  });

  it("leaves out an empty part", () => {
    expect(fullName({ preferred_name: "Jim", given_names: null, surname: null })).toBe("Jim");
    expect(fullName({ preferred_name: "", given_names: "", surname: "Smith" })).toBe("Smith");
    expect(fullName({ preferred_name: null, given_names: null, surname: "" })).toBe("");
  });

  it("is empty for no person, so callers add their own fallback", () => {
    expect(fullName(null)).toBe("");
    expect(fullName(undefined)).toBe("");
    expect(fullName(null) || "(no name)").toBe("(no name)");
  });

  it("trims nothing", () => {
    expect(fullName({ preferred_name: " ", given_names: "James", surname: "Smith" })).toBe("  Smith");
    expect(fullName({ preferred_name: "Jim", surname: " " })).toBe("Jim  ");
  });
});

// The expressions the call sites used before this helper. Every combination
// must give the same answer, so the swap changed no output.
describe("same output as the replaced expressions", () => {
  const values = [undefined, null, "", " ", "Jim", "Mary Jane"] as const;
  const rows = values.flatMap((pref) => values.flatMap((given) => values.map((surname) => ({ pref, given, surname }))));

  it("database rows", () => {
    for (const { pref, given, surname } of rows) {
      const p = { preferred_name: pref, given_names: given, surname };
      expect(fullName(p)).toBe([p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" "));
      expect(firstName(p) || null).toBe(p.preferred_name || p.given_names || null);
      expect(firstName(p).split(" ")[0]).toBe((p.preferred_name || p.given_names || "").split(" ")[0]);
    }
  });

  it("API objects", () => {
    for (const { pref, given, surname } of rows) {
      const p = { preferredName: pref, givenNames: given, surname };
      expect(fullName(p) || "Player").toBe([p.preferredName || p.givenNames, p.surname].filter(Boolean).join(" ") || "Player");
      expect(firstName(p) || "Player").toBe(p.preferredName || p.givenNames || "Player");
    }
  });
});
