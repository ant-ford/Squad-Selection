import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePostgrest, SUPABASE_TEST_ENV } from "./helpers/postgrest";
import type { Env } from "../worker/src/env";
import { activeOfficeHolders, contactOf, officeAddress, officeContact, senderFor } from "../worker/src/officeContacts";

const env = { ...SUPABASE_TEST_ENV, REVIEW_EMAIL_FROM: "Anthony Ford <menscaptain@hkfchockey.com>" } as Env;
afterEach(() => vi.unstubAllGlobals());

const person = (id: string, preferred: string | null, given: string | null, surname: string | null, email: string | null) => ({
  id, api_id: `rec${id}`, preferred_name: preferred, given_names: given, surname, email,
});

describe("contactOf", () => {
  it("writes to the office's own mailbox first", () => {
    expect(contactOf({ office_email: "mensmembership@hkfchockey.com", people: person("p1", "Dan", "Daniel", "Cai", "dan@x.com") })).toEqual({
      name: "Dan Cai",
      firstName: "Dan",
      email: "mensmembership@hkfchockey.com",
      personId: "p1",
      apiId: "recp1",
    });
  });

  it("falls back to the holder's own email", () => {
    expect(contactOf({ office_email: null, people: person("p2", null, "Chris", "Jones", "chris@x.com") })).toMatchObject({ name: "Chris Jones", firstName: "Chris", email: "chris@x.com" });
    expect(contactOf({ office_email: "", people: person("p2", null, "Chris", null, "chris@x.com") })).toMatchObject({ name: "Chris", email: "chris@x.com" });
  });

  it("has no email (null) when neither is there, and nothing at all without a row", () => {
    expect(contactOf({ office_email: null, people: person("p3", "Al", null, "B", null) }).email).toBeNull();
    expect(contactOf({ office_email: "kit@x.com", people: null })).toEqual({ name: null, firstName: null, email: "kit@x.com", personId: null, apiId: null });
    expect(contactOf(undefined)).toEqual({ name: null, firstName: null, email: null, personId: null, apiId: null });
    expect(officeAddress(null, undefined)).toBeNull();
    expect(officeAddress("", "me@x.com")).toBe("me@x.com");
  });
});

describe("senderFor", () => {
  it("sends from the office's mailbox when it is on hkfchockey.com", () => {
    expect(senderFor(env, "Ant Ford", "menscaptain@hkfchockey.com")).toBe("Ant Ford <menscaptain@hkfchockey.com>");
  });

  it("else from REVIEW_EMAIL_FROM, or the mailer's default without it", () => {
    expect(senderFor(env, "Ant Ford", "ant@gmail.com")).toBe("Anthony Ford <menscaptain@hkfchockey.com>");
    expect(senderFor(env, "Ant Ford", null)).toBe("Anthony Ford <menscaptain@hkfchockey.com>");
    expect(senderFor({ REVIEW_EMAIL_FROM: "" }, "Ant Ford", undefined)).toBeUndefined();
  });
});

describe("reading an office's Active holders", () => {
  const relations = { "offices.offices_person_id_fkey": { table: "people", from: "person_id", to: "id", kind: "one" as const } };
  const people = [person("p1", "Lee", "Shirndré-Lee", "Simmons", "lee@x.com"), person("p2", "Old", null, "Holder", "old@x.com")];
  const office = (id: string, role: string, status: string, personId: string | null, mailbox: string | null, created: string) => ({
    id, role, designation: null, office_email: mailbox, person_id: personId, status, created_at: created,
  });

  it("reads one role's Active holders, oldest first, in one call", async () => {
    const pg = fakePostgrest({
      tables: {
        offices: [
          office("o3", "hockey_convenor", "Active", "p2", null, "2026-10-02"),
          office("o2", "hockey_convenor", "Active", "p1", "convenor@hkfchockey.com", "2026-10-01"),
          office("o1", "hockey_convenor", "Retired", "p2", null, "2026-09-01"),
          office("o4", "sponsor", "Active", "p1", null, "2026-09-01"),
        ],
        people,
      },
      relations,
    });
    const rows = await activeOfficeHolders(env, "hockey_convenor");
    expect(rows.map((r) => r.id)).toEqual(["o2", "o3"]);
    expect(rows[0].people?.api_id).toBe("recp1");
    expect(pg.calls).toHaveLength(1);
  });

  it("gives the holder of a one-holder office as a contact, or null when nobody holds it", async () => {
    fakePostgrest({
      tables: { offices: [office("o9", "assistant_director", "Active", "p1", "adh@x.com", "2026-10-04")], people },
      relations,
    });
    expect(await officeContact(env, "assistant_director")).toMatchObject({ name: "Lee Simmons", firstName: "Lee", email: "adh@x.com", personId: "p1" });
    fakePostgrest({
      tables: { offices: [office("o9", "assistant_director", "Retired", "p1", "adh@x.com", "2026-10-04")], people },
      relations,
    });
    expect(await officeContact(env, "assistant_director")).toBeNull();
  });
});
