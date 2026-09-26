import { describe, it, expect } from "vitest";
import { buildNameDictionary, canonicalKey, parseUmpire, tidy } from "../shared/umpires";

// Every format below is copied from ten seasons of real Ump 1 / Ump 2
// values; the names are made up (the repository is public).

const teams = new Set(["HKFC F", "Khalsa C", "Kai Tak B", "Valley E", "Nanki", "Hockey Clube de Macau", "144U A"]);
const clean = [
  "Appt - Alex Wong",
  "HKFC F - Sam Lee",
  "Pat Chan",
  "Appt - Robin Cheng",
  "Appt - Kim Tsang (Kenny)",
  "Valley E - Jo Blake",
];
const names = buildNameDictionary(clean, teams);
const parse = (v: unknown) => parseUmpire(v, { teams, names });

describe("the shapes of an umpire value", () => {
  it.each([
    ["Appointed", { kind: "appointed" }],
    ["Appt", { kind: "appointed" }],
    ["Appt - Alex Wong", { kind: "appointed", name: "Alex Wong", key: "alex wong" }],
    ["HKFC F - Sam Lee", { kind: "duty", duty: "HKFC F", name: "Sam Lee" }],
    ["Khalsa C", { kind: "duty", duty: "Khalsa C" }],
    ["Nanki", { kind: "duty", duty: "Nanki" }],
    ["Pat Chan", { kind: "name", name: "Pat Chan" }],
    ["Pat Chan - 4477", { kind: "name", name: "Pat Chan", number: "4477" }],
    ["144U A - Pat Chan", { kind: "duty", duty: "144U A", name: "Pat Chan" }],
    ["Hockey Clube de Macau - Pat Chan", { kind: "duty", duty: "Hockey Clube de Macau", name: "Pat Chan" }],
    ["JR - Pat Chan", { kind: "duty", duty: "JR", name: "Pat Chan" }],
    ["", { kind: "none" }],
    [undefined, { kind: "none" }],
  ])("%j", (raw, expected) => {
    expect(parse(raw)).toMatchObject(expected);
  });
});

describe("the traps", () => {
  it("turns the stray Â from a non-breaking space back into a space", () => {
    expect(tidy("KimÂ Tsang (Kenny)")).toBe("Kim Tsang (Kenny)");
    expect(parse("Appt - KimÂ Tsang (Kenny)")).toMatchObject({ name: "Kim Tsang (Kenny)" });
    expect(parse("Robin ChengÂ")).toMatchObject({ name: "Robin Cheng" });
  });

  it("splits an HKHA note glued onto a known name", () => {
    expect(parse("Appt - Alex WongRate by Home Team: 4 - very good")).toMatchObject({
      kind: "appointed",
      name: "Alex Wong",
      note: "Rate by Home Team: 4 - very good",
    });
    expect(parse("HKFC F - Sam LeeKhalsa C umpire no show, Jo is assessor.")).toMatchObject({
      duty: "HKFC F",
      name: "Sam Lee",
      note: "Khalsa C umpire no show, Jo is assessor.",
    });
  });

  it("splits a glued note off a name it has not seen, at the case seam", () => {
    expect(parse("Appt - Lee MorganY2 for no. 126 of HKFC D according to Lee.")).toMatchObject({
      name: "Lee Morgan",
      note: "Y2 for no. 126 of HKFC D according to Lee.",
    });
  });

  it("does not split a name like McDonald", () => {
    expect(parse("Appt - Ian McDonald")).toMatchObject({ name: "Ian McDonald" });
  });

  it("reads a duty team with a note glued on", () => {
    expect(parse("HKFC FHKFC F umpire no show. Sam umpired the match.")).toMatchObject({
      kind: "duty",
      duty: "HKFC F",
      note: "HKFC F umpire no show. Sam umpired the match.",
    });
  });

  it("takes the first line of a quoted multi-line value", () => {
    expect(parse('"Valley E - Jo BlakeIt was done by Jo Blake Umpire No. 4421.\nThere was an issue with the e-card"')).toMatchObject({
      duty: "Valley E",
      name: "Jo Blake",
      note: "It was done by Jo Blake Umpire No. 4421. There was an issue with the e-card",
    });
  });
});

describe("one person however the name is written", () => {
  it("matches across case, word order, brackets, commas and (OLD NAME)", () => {
    expect(canonicalKey("SINGH Kuldeep")).toBe(canonicalKey("Kuldeep Singh"));
    expect(canonicalKey("Jelena SURNAME")).toBe(canonicalKey("Jelena Surname"));
    expect(canonicalKey("Singh, Gurcharan Bir (OLD NAME)")).toBe(canonicalKey("Gurcharan Bir Singh"));
    expect(canonicalKey("Kim Tsang (Kenny)")).toBe(canonicalKey("Kim  TSANG (Kenny)"));
    expect(canonicalKey("Kim Tsang")).not.toBe(canonicalKey("Kim Tsang (Kenny)"));
  });

  it("joins the names the alias list says are one person", () => {
    // The one real pair in this file: it lives in UMPIRE_ALIASES anyway.
    const now = parse("144U A - Gurcharan");
    const old = parse("144U B - Singh, Gurcharan Bir (OLD NAME)");
    expect(now).toMatchObject({ name: "Gurcharan", key: "gurcharan" });
    expect(old).toMatchObject({ name: "Gurcharan", key: "gurcharan" });
  });

  it("builds its dictionary from clean values only", () => {
    expect(buildNameDictionary(["Appt - Alex WongRate by Home Team: 4", "Appt - Robin Cheng", "HKFC F"], teams)).toEqual([
      "Robin Cheng",
    ]);
  });
});
