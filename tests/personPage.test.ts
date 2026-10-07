import { describe, expect, it } from "vitest";
import { personPageHref } from "../src/lib/personPage";

describe("personPageHref", () => {
  it("links a name to the person page for viewers who open People", () => {
    expect(personPageHref(["membership", "people"], "recAbc123")).toBe("/people/recAbc123");
    expect(personPageHref(["registration", "people"], "a b/c")).toBe("/people/a%20b%2Fc");
  });

  it("leaves the name plain without the people section", () => {
    expect(personPageHref(["membership"], "recAbc123")).toBeNull();
    expect(personPageHref([], "recAbc123")).toBeNull();
    expect(personPageHref(undefined, "recAbc123")).toBeNull();
  });

  it("leaves the name plain when the row has no person", () => {
    expect(personPageHref(["people"], undefined)).toBeNull();
    expect(personPageHref(["people"], null)).toBeNull();
    expect(personPageHref(["people"], "")).toBeNull();
  });
});
