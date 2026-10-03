import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import type { DirectoryPerson } from "../shared/emailLists";

const DIR: DirectoryPerson[] = [];
vi.mock("../worker/src/chairman", () => ({ getChairmanDirectory: async () => ({ people: DIR, generatedAt: "" }) }));

import { eventTasks, getMyEvents, respondToEvent, saveEvent } from "../worker/src/events";
import { formatEventVEvent } from "../worker/src/calendar";
import { invalidateAll } from "../worker/src/cache";
import { answerRefusal, cleanAudience, cleanGuests, effectiveAudience, isOpen } from "../shared/events";

const env = { DATA_BACKEND: "supabase", DATA_SUPABASE_URL: "https://proj.supabase.co", DATA_SUPABASE_SECRET_KEY: "sb_secret_test" } as Env;
const userOf = (personId: string, extra: Partial<AuthorizedUser> = {}) =>
  ({ email: `${personId}@x.com`, personId, role: "player", coachTeams: [], isSectionCaptain: false, officerRoles: [], ...extra }) as AuthorizedUser;

const person = (id: string, name: string, team: string, status = "Member"): DirectoryPerson => ({
  id,
  name,
  surname: name.split(" ").pop()!,
  values: { status: [status], active: ["Active player"], team: [team] },
  emails: [],
  emailSource: "none",
  under18: false,
});
DIR.push(person("recDAD", "Dave Smith", "HKFC C"), person("recSON", "Sam Smith", "HKFC D"), person("recAPP", "Alex Applicant", "HKFC D", "Applicant"), person("recSEC", "Sue Sec", "HKFC D"));
const UUID: Record<string, string> = { recDAD: "uuid-dad", recSON: "uuid-son", recAPP: "uuid-app", recSEC: "uuid-sec" };

const day = 86_400_000;
const EVENT_ID = "11111111-2222-3333-4444-555555555555";
const event = (over: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  event_type: "social_function",
  title: "Christmas Party",
  description: null,
  location: "Members' Bar",
  starts_at: new Date(Date.now() + 10 * day).toISOString(),
  ends_at: null,
  respond_by: new Date(Date.now() + 7 * day).toISOString(),
  member_price: 350,
  guest_adult_price: 400,
  guest_child_price: null,
  payment_mode: "on_the_night",
  guests_allowed: true,
  max_guests: 2,
  help_needed: null,
  social_function: "Christmas Party",
  team_id: null,
  audience: { status: ["Member"], active: ["Active player"] },
  status: "published",
  team: null,
  ...over,
});

type Call = { url: URL; method: string; body: any };
/** A fake PostgREST: `events`, `responses` (rows for event_responses), offices and team_people per uuid. */
function fake(opts: { events?: unknown[]; responses?: unknown[]; offices?: Record<string, unknown[]>; teamPeople?: Record<string, unknown[]>; teams?: unknown[] } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const table = url.pathname.split("/").pop()!;
      const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (method !== "GET") return reply([{ id: "new-id" }]);
      const q = url.searchParams;
      const eqOf = (k: string) => q.get(k)?.replace(/^eq\./, "");
      switch (table) {
        case "people": {
          const api = eqOf("api_id")!;
          return reply(UUID[api] ? [{ id: UUID[api], preferred_name: null, given_names: DIR.find((p) => p.id === api)?.name.split(" ")[0], surname: "Smith" }] : []);
        }
        case "offices":
          return reply(opts.offices?.[eqOf("person_id")!] ?? []);
        case "team_people":
          return reply(opts.teamPeople?.[eqOf("person_id")!] ?? []);
        case "teams":
          return reply(opts.teams ?? []);
        case "events":
          return reply(opts.events ?? []);
        case "event_responses": {
          const rows = (opts.responses ?? []) as { person_id: string }[];
          const pid = eqOf("person_id");
          return reply(pid ? rows.filter((r) => r.person_id === pid) : rows);
        }
        default:
          return reply([]);
      }
    }),
  );
  return calls;
}
afterEach(() => {
  vi.unstubAllGlobals();
  invalidateAll();
});
const upsertOf = (calls: Call[]) => calls.find((c) => c.url.pathname.endsWith("/event_responses") && c.method === "POST");

describe("event rules", () => {
  it("checks guests against what the event allows", () => {
    expect(cleanGuests([], false, null)).toEqual([]);
    expect(cleanGuests([{ name: "Jo", age: "adult" }], false, null)).toMatch(/isn't open to guests/);
    expect(cleanGuests([{ name: "A" }, { name: "B" }], true, 1)).toMatch(/up to 1 guest\./);
    expect(cleanGuests([{ name: " " }], true, 2)).toMatch(/name/);
    expect(cleanGuests([{ name: " Jo ", age: "child", dietary: " vegetarian " }], true, 2)).toEqual([{ name: "Jo", age: "child", dietary: "vegetarian" }]);
  });

  it("lets anyone sign up someone who hasn't answered, and only them or their signer change it after", () => {
    expect(answerRefusal({ actorId: "a", targetId: "b", manager: false, existing: null })).toBeNull();
    expect(answerRefusal({ actorId: "a", targetId: "b", manager: false, existing: { signedUpById: "a" } })).toBeNull();
    expect(answerRefusal({ actorId: "b", targetId: "b", manager: false, existing: { signedUpById: "a" } })).toBeNull();
    expect(answerRefusal({ actorId: "c", targetId: "b", manager: false, existing: { signedUpById: "a", signedUpByName: "Dave", targetName: "Sam" } })).toBe("Sam: already signed up by Dave.");
    expect(answerRefusal({ actorId: "c", targetId: "b", manager: false, existing: { signedUpById: null, targetName: "Sam" } })).toMatch(/answered for themselves/);
    expect(answerRefusal({ actorId: "c", targetId: "b", manager: true, existing: { signedUpById: null } })).toBeNull();
  });

  it("closes answers at the deadline, or at the start when there's none", () => {
    const now = Date.now();
    const iso = (t: number) => new Date(t).toISOString();
    expect(isOpen({ status: "published", startsAt: iso(now + day), respondBy: null }, now)).toBe(true);
    expect(isOpen({ status: "published", startsAt: iso(now + day), respondBy: iso(now - 1000) }, now)).toBe(false);
    expect(isOpen({ status: "draft", startsAt: iso(now + day), respondBy: null }, now)).toBe(false);
  });

  it("keeps only the event groups, and a team's event for that team", () => {
    expect(cleanAudience({ status: ["Member"], ageBand: ["U18"], team: "HKFC A" })).toEqual({ status: ["Member"] });
    expect(effectiveAudience({ team: ["HKFC A", "HKFC B"], status: ["Member"] }, "HKFC D")).toEqual({ team: ["HKFC D"], status: ["Member"] });
  });
});

describe("answering an event", () => {
  it("saves your own answer with nobody else paying", async () => {
    const calls = fake({ events: [event()] });
    await respondToEvent(env, userOf("recDAD"), EVENT_ID, { status: "going", guests: [{ name: "Jane", age: "adult", dietary: "No nuts" }] });
    const write = upsertOf(calls)!;
    expect(write.url.searchParams.get("on_conflict")).toBe("event_id,person_id");
    expect(write.body[0]).toMatchObject({ event_id: EVENT_ID, person_id: "uuid-dad", status: "going", signed_up_by_id: null, guests: [{ name: "Jane", age: "adult", dietary: "No nuts" }] });
  });

  it("records whoever signs another player up as the payer", async () => {
    const calls = fake({ events: [event()] });
    await respondToEvent(env, userOf("recDAD"), EVENT_ID, { personId: "recSON", status: "going" });
    expect(upsertOf(calls)!.body[0]).toMatchObject({ person_id: "uuid-son", signed_up_by_id: "uuid-dad" });
  });

  it("keeps the payer when the player changes the answer themselves", async () => {
    const calls = fake({ events: [event()], responses: [{ person_id: "uuid-son", signed_up_by_id: "uuid-dad", signer: { preferred_name: "Dave", given_names: null, surname: "Smith" } }] });
    await respondToEvent(env, userOf("recSON"), EVENT_ID, { status: "maybe" });
    expect(upsertOf(calls)!.body[0]).toMatchObject({ person_id: "uuid-son", status: "maybe", signed_up_by_id: "uuid-dad" });
  });

  it("won't sign up someone who already answered, or someone not invited", async () => {
    fake({ events: [event()], responses: [{ person_id: "uuid-son", signed_up_by_id: null, signer: null }] });
    await expect(respondToEvent(env, userOf("recDAD"), EVENT_ID, { personId: "recSON", status: "going" })).rejects.toThrow(/already answered/);
    invalidateAll();
    fake({ events: [event()] });
    await expect(respondToEvent(env, userOf("recDAD"), EVENT_ID, { personId: "recAPP", status: "going" })).rejects.toThrow(/isn't invited/);
  });

  it("refuses after the deadline, except for the event's social secretaries", async () => {
    const closed = event({ respond_by: new Date(Date.now() - 1000).toISOString() });
    fake({ events: [closed] });
    await expect(respondToEvent(env, userOf("recDAD"), EVENT_ID, { status: "going" })).rejects.toThrow(/closed/);
    invalidateAll();
    const calls = fake({ events: [closed], offices: { "uuid-sec": [{ id: "office" }] } });
    await respondToEvent(env, userOf("recSEC"), EVENT_ID, { personId: "recDAD", status: "going", asManager: true });
    // On the person's behalf: nobody else pays.
    expect(upsertOf(calls)!.body[0]).toMatchObject({ person_id: "uuid-dad", signed_up_by_id: null });
  });

  it("rejects guests when the event isn't open to them", async () => {
    fake({ events: [event({ guests_allowed: false, max_guests: null })] });
    await expect(respondToEvent(env, userOf("recDAD"), EVENT_ID, { status: "going", guests: [{ name: "Jane" }] })).rejects.toThrow(/isn't open to guests/);
  });
});

describe("the player page and My Tasks", () => {
  it("shows invited events, and hides a cancelled one they never answered", async () => {
    fake({ events: [event(), event({ id: "22222222-2222-3333-4444-555555555555", status: "cancelled" })] });
    const { events } = await getMyEvents(env, userOf("recDAD"));
    expect(events.map((e) => e.id)).toEqual([EVENT_ID]);
    expect(events[0]).toMatchObject({ invited: true, open: true, mine: null, memberPrice: 350 });
  });

  it("asks about an open event until they answer", async () => {
    const open = event();
    fake({ events: [open] });
    expect(await eventTasks(env, userOf("recDAD"))).toEqual([{ id: EVENT_ID, title: "Christmas Party", due: open.respond_by }]);
    invalidateAll();
    fake({ events: [event()], responses: [{ person_id: "uuid-dad", event_id: EVENT_ID }] });
    expect(await eventTasks(env, userOf("recDAD"))).toEqual([]);
    invalidateAll();
    // Applicants aren't in the default audience.
    fake({ events: [event()] });
    expect(await eventTasks(env, userOf("recAPP"))).toEqual([]);
  });
});

describe("keeping events", () => {
  it("lets a team's social secretary add events for their own team only", async () => {
    const teamPeople = { "uuid-sec": [{ teams: { id: "team-d", team_name: "HKFC D" } }] };
    const body = { type: "team_social", title: "Curry night", startsAt: new Date(Date.now() + 5 * day).toISOString() };
    fake({ teamPeople });
    await expect(saveEvent(env, userOf("recSEC"), body)).rejects.toThrow(/Choose your team/);
    invalidateAll();
    fake({ teamPeople, teams: [{ id: "team-c" }] });
    await expect(saveEvent(env, userOf("recSEC"), { ...body, team: "HKFC C" })).rejects.toThrow(/your own team/);
    invalidateAll();
    const calls = fake({ teamPeople, teams: [{ id: "team-d" }] });
    await saveEvent(env, userOf("recSEC"), { ...body, team: "HKFC D" });
    const insert = calls.find((c) => c.url.pathname.endsWith("/events") && c.method === "POST")!;
    expect(insert.body[0]).toMatchObject({ title: "Curry night", team_id: "team-d", status: "draft", created_by: "uuid-sec", audience: { status: ["Member"], active: ["Active player"] } });
  });

  it("keeps players out of the Events screen", async () => {
    fake();
    await expect(saveEvent(env, userOf("recDAD"), { type: "team_social", title: "x", startsAt: new Date().toISOString() })).rejects.toThrow(/social secretaries/);
  });
});

describe("events in the calendar feed", () => {
  const base = {
    id: EVENT_ID,
    type: "social_function" as const,
    title: "Christmas Party",
    description: null,
    location: "Members' Bar",
    startsAt: "2026-12-12T11:00:00.000Z",
    endsAt: null,
    respondBy: null,
    memberPrice: 350,
    guestAdultPrice: null,
    guestChildPrice: null,
    paymentMode: "on_the_night" as const,
    guestsAllowed: true,
    maxGuests: 2,
    helpNeeded: null,
    socialFunction: null,
    team: null,
    status: "published" as const,
    posterUrl: null,
  };
  const unfold = (s: string) => s.replace(/\r\n /g, "");

  it("puts Going in as confirmed, three hours long, with a link back", () => {
    const ics = unfold(formatEventVEvent({ ...base, answer: "going", guests: 1 }, "https://app.eddy.global"));
    expect(ics).toContain("UID:event-11111111-2222-3333-4444-555555555555@hkfc-squad-selection");
    expect(ics).toContain("DTSTART;TZID=Asia/Hong_Kong:20261212T190000");
    expect(ics).toContain("DTEND;TZID=Asia/Hong_Kong:20261212T220000");
    expect(ics).toContain("SUMMARY:Christmas Party");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("Your answer: Going (+1 guest)");
    expect(ics).toContain("HK$350 · Pay on the night");
    expect(ics).toContain("https://app.eddy.global/?event=11111111");
  });

  it("marks Maybe as tentative and a cancelled event as cancelled", () => {
    expect(unfold(formatEventVEvent({ ...base, answer: "maybe", guests: 0 }, "x"))).toMatch(/SUMMARY:Christmas Party \(maybe\)[\s\S]*STATUS:TENTATIVE/);
    expect(unfold(formatEventVEvent({ ...base, status: "cancelled", answer: "going", guests: 0 }, "x"))).toMatch(/SUMMARY:CANCELLED: Christmas Party[\s\S]*STATUS:CANCELLED/);
  });
});
