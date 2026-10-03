import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import type { DirectoryPerson } from "../shared/emailLists";

const DIR: DirectoryPerson[] = [];
vi.mock("../worker/src/chairman", () => ({ getChairmanDirectory: async () => ({ people: DIR, generatedAt: "" }) }));

import { eventTasks, getMyEvents, markNoShow, respondToEvent, saveEvent, uploadPaymentProof } from "../worker/src/events";
import { attendedEvents } from "../worker/src/eventAttendance";
import { recordedSocialFunctions } from "../shared/commitmentReview";
import { toPaymentRead } from "../worker/src/paymentRead";
import { formatEventVEvent } from "../worker/src/calendar";
import { invalidateAll } from "../worker/src/cache";
import { answersCsv, cleanAnswers, cleanQuestions, missingAnswer, answerRefusal, audienceOptions, chargesCsv, cleanAudience, cleanGuests, computeCharges, describeAudience, effectiveAudience, isOpen, judgeProof, type ChargeInput } from "../shared/events";
import { ANY } from "../shared/emailLists";

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
function fake(opts: { events?: unknown[]; responses?: unknown[]; offices?: Record<string, unknown[]>; teamPeople?: Record<string, unknown[]>; teams?: unknown[]; payments?: unknown[]; used?: unknown[]; ai?: string } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const table = url.pathname.split("/").pop()!;
      const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.host === "openrouter.ai") return reply({ choices: [{ message: { content: opts.ai ?? "{}" } }] });
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
        case "event_payments":
          return reply(q.get("reference") ? (opts.used ?? []) : (opts.payments ?? []));
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

  it("offers umpires as one option, never by grade, and says who's invited in a line", () => {
    expect(audienceOptions("qualifiedUmpire", ["Level 1", "Level 2"])).toEqual([{ value: ANY, label: "Qualified umpires" }]);
    expect(audienceOptions("tourInterest", ["Bangkok 11s"])).toEqual([{ value: ANY, label: "Any tour" }, { value: "Bangkok 11s", label: "Bangkok 11s" }]);
    expect(audienceOptions("team", ["HKFC A"])).toEqual([{ value: "HKFC A", label: "HKFC A" }]);
    expect(describeAudience({ status: ["Member"], active: ["Active player"], tourInterest: ["Bangkok 11s"] }, null)).toBe("Member · Active player · Tour interest: Bangkok 11s");
    expect(describeAudience({ qualifiedUmpire: [ANY] }, "HKFC D")).toBe("HKFC D · Qualified umpire: Qualified umpires");
    expect(describeAudience({}, null)).toBe("Everyone");
  });
});

describe("answering an event", () => {
  it("saves your own answer with nobody else paying, and the event's questions", async () => {
    const asks = event({ questions: [{ key: "dietary", label: "Dietary requirements" }, { key: "q1", label: "T-shirt size" }] });
    const calls = fake({ events: [asks] });
    await respondToEvent(env, userOf("recDAD"), EVENT_ID, {
      status: "going",
      guests: [{ name: "Jane", age: "adult", dietary: "No nuts" }],
      answers: { dietary: "Vegetarian", q1: "L", q9: "not asked" },
    });
    const write = upsertOf(calls)!;
    expect(write.url.searchParams.get("on_conflict")).toBe("event_id,person_id");
    expect(write.body[0]).toMatchObject({
      event_id: EVENT_ID, person_id: "uuid-dad", status: "going", signed_up_by_id: null,
      guests: [{ name: "Jane", age: "adult", dietary: "No nuts" }],
      answers: { dietary: "Vegetarian", q1: "L" },
    });
  });

  it("drops guests' dietary needs and stray answers when the event doesn't ask", async () => {
    const calls = fake({ events: [event()] });
    await respondToEvent(env, userOf("recDAD"), EVENT_ID, { status: "going", guests: [{ name: "Jane", age: "adult", dietary: "No nuts" }], answers: { dietary: "Vegan" } });
    expect(upsertOf(calls)!.body[0]).toMatchObject({ guests: [{ name: "Jane", age: "adult" }], answers: {} });
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
    paymentDetails: null,
    guestsAllowed: true,
    maxGuests: 2,
    helpNeeded: null,
    questions: [],
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

describe("paying for events", () => {
  const dave = { personId: "recDAD", name: "Dave Smith", membershipNo: "M1" };
  const answer = (over: Partial<ChargeInput>): ChargeInput => ({ name: "Dave Smith", status: "going", guests: [], waived: false, payer: dave, ...over });

  it("bills whoever signed people up, with their guests, and skips Maybe, Not going and waived", () => {
    const bills = computeCharges({ memberPrice: 350, guestAdultPrice: 400, guestChildPrice: null }, [
      answer({ guests: [{ name: "Jane", age: "adult" }] }),
      answer({ name: "Sam Smith", guests: [{ name: "Tom", age: "child" }] }),
      answer({ name: "Ann Lee", status: "maybe", payer: { personId: "recANN", name: "Ann Lee", membershipNo: null } }),
      answer({ name: "Bob Lee", waived: true, payer: { personId: "recBOB", name: "Bob Lee", membershipNo: null } }),
    ]);
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ payerId: "recDAD", membershipNo: "M1", total: 1500 });
    // A child guest with no child price pays the adult guest price.
    expect(bills[0].lines.map((l) => [l.name, l.what, l.amount])).toEqual([
      ["Dave Smith", "Member", 350],
      ["Jane", "Adult guest", 400],
      ["Sam Smith", "Member", 350],
      ["Tom", "Child guest", 400],
    ]);
    // With no guest prices at all, guests pay the member price.
    expect(computeCharges({ memberPrice: 200, guestAdultPrice: null, guestChildPrice: null }, [answer({ guests: [{ name: "Jo", age: "child" }] })])[0].total).toBe(400);
  });

  it("judges a screenshot against the bill, a reused reference first", () => {
    expect(judgeProof({ amount: 750 }, 750, false)).toBe("matched");
    expect(judgeProof({ amount: 700 }, 750, false)).toBe("amount_differs");
    expect(judgeProof({ amount: null }, 750, false)).toBe("unreadable");
    expect(judgeProof({ amount: 750 }, 750, true)).toBe("duplicate");
  });

  it("makes the treasurer's list, one line per payer who owes something", () => {
    const csv = chargesCsv("Christmas Party", "11 Dec 2026", [
      { payerId: "recDAD", name: "Dave Smith", membershipNo: "M1", total: 750, lines: [{ name: "Dave Smith", what: "Member", amount: 350 }, { name: "Jane, Smith", what: "Adult guest", amount: 400 }] },
      { payerId: "recX", name: "Nobody", membershipNo: null, total: 0, lines: [] },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "Name,Membership no.,Amount (HK$),For,Event,Date",
      'Dave Smith,M1,750.00,"Dave Smith; Jane, Smith (adult guest)",Christmas Party,11 Dec 2026',
    ]);
  });

  it("keeps only what it can trust from a screenshot", () => {
    expect(toPaymentRead({ amount: "HK$750.00", currency: "HKD", date: "2026-12-01", reference: "FRN 2026 1201", payee: "Sue Sec", succeeded: true })).toEqual({ amount: 750, paidOn: "2026-12-01", reference: "FRN20261201", payee: "Sue Sec" });
    expect(toPaymentRead({ amount: 750, currency: "USD" }).amount).toBeNull();
    expect(toPaymentRead({ amount: 750, succeeded: false }).amount).toBeNull();
    expect(toPaymentRead({ amount: 750, date: "1 Dec" }).paidOn).toBeNull();
    expect(toPaymentRead(null)).toEqual({ amount: null, paidOn: null, reference: null, payee: null });
  });

  it("stores a payer's screenshot, reads it and flags a reference used before", async () => {
    const files = { put: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) };
    const payEnv = { ...env, OPENROUTER_API_KEY: "or_test", FILES: files } as unknown as Env;
    const paid = event({ payment_mode: "payme_fps", payment_details: "FPS 1234567" });
    const daveRow = {
      event_id: EVENT_ID, person_id: "uuid-dad", status: "going", guests: [{ name: "Jane", age: "adult" }], charge_waived: false, signed_up_by_id: null,
      person: { api_id: "recDAD", preferred_name: "Dave", given_names: null, surname: "Smith", membership_no: "M1" }, signer: null,
    };
    const saved = {
      event_id: EVENT_ID, payer_id: "uuid-dad", file_id: null, amount_due: 750, amount_read: 750, paid_on: null, reference: "R1", payee: null,
      read_status: "matched", confirmed_at: null, created_at: "", updated_at: "2026-12-01T00:00:00Z", payer: { api_id: "recDAD" }, confirmer: null,
    };
    const img = "data:image/jpeg;base64,AAAA";
    const writeOf = (calls: Call[]) => calls.find((c) => c.url.pathname.endsWith("/event_payments") && c.method === "POST")!;

    let calls = fake({ events: [paid], responses: [daveRow], payments: [saved], ai: '{"amount": 750, "currency": "HKD", "reference": "R1", "succeeded": true}' });
    await uploadPaymentProof(payEnv, userOf("recDAD"), EVENT_ID, { dataUrl: img });
    expect(writeOf(calls).body[0]).toMatchObject({ payer_id: "uuid-dad", amount_due: 750, amount_read: 750, reference: "R1", read_status: "matched", confirmed_at: null });
    expect(files.put).toHaveBeenCalledOnce();

    invalidateAll();
    calls = fake({ events: [paid], responses: [daveRow], payments: [saved], used: [{ event_id: "other-event", payer_id: "uuid-son" }], ai: '{"amount": 750, "reference": "R1"}' });
    await uploadPaymentProof(payEnv, userOf("recDAD"), EVENT_ID, { dataUrl: img });
    expect(writeOf(calls).body[0].read_status).toBe("duplicate");

    invalidateAll();
    fake({ events: [paid], responses: [] });
    await expect(uploadPaymentProof(payEnv, userOf("recDAD"), EVENT_ID, { dataUrl: img })).rejects.toThrow(/nothing to pay/);
  });
});

describe("questions an event asks", () => {
  it("keeps dietary first and renumbers up to four of the social secretary's own", () => {
    expect(cleanQuestions([{ key: "q7", label: " T-shirt size " }, { key: "dietary" }, { label: "" }, { label: "Arriving by" }])).toEqual([
      { key: "dietary", label: "Dietary requirements" },
      { key: "q1", label: "T-shirt size" },
      { key: "q2", label: "Arriving by" },
    ]);
    expect(cleanQuestions(["x", null, { label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }, { label: "e" }]).map((q) => q.key)).toEqual(["q1", "q2", "q3", "q4"]);
    expect(cleanAnswers({ q1: " L ", q2: 5, q3: "x" }, [{ key: "q1", label: "Size" }, { key: "q2", label: "Age" }])).toEqual({ q1: "L" });
  });

  it("lists everyone's answers for the caterer, guests under the member who brings them", () => {
    const csv = answersCsv({ questions: [{ key: "dietary", label: "Dietary requirements" }] }, [
      { name: "Dave Smith", status: "going", guests: [{ name: "Jane", age: "adult", dietary: "No nuts" }], answers: { dietary: "Vegetarian" }, canHelp: true, notes: null },
      { name: "Ann Lee", status: "not_going", guests: [], answers: {}, canHelp: false, notes: null },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "Name,Answer,Guest of,Dietary requirements,Can help,Note",
      "Dave Smith,Going,,Vegetarian,Yes,",
      "Jane,Guest (adult),Dave Smith,No nuts,,",
    ]);
  });
});

describe("required questions", () => {
  const qs = cleanQuestions([{ key: "dietary", required: true }, { label: "T-shirt size", required: true }, { label: "Arriving by" }]);

  it("keeps the required tick, and says which answer is missing", () => {
    expect(qs).toEqual([
      { key: "dietary", label: "Dietary requirements", required: true },
      { key: "q1", label: "T-shirt size", required: true },
      { key: "q2", label: "Arriving by" },
    ]);
    expect(missingAnswer(qs, {}, [])).toMatch(/dietary requirements \(write None/);
    expect(missingAnswer(qs, { dietary: "None" }, [])).toBe("Answer “T-shirt size”.");
    expect(missingAnswer(qs, { dietary: "None", q1: "L" }, [{ name: "Jane", age: "adult" }])).toBe("Give Jane's dietary requirements (None if they have none).");
    expect(missingAnswer(qs, { dietary: "None", q1: "L" }, [{ name: "Jane", age: "adult", dietary: "Vegan" }])).toBeNull();
  });

  it("won't save Going without them, but Not going and a social secretary's answer are fine", async () => {
    const asks = event({ questions: qs });
    fake({ events: [asks] });
    await expect(respondToEvent(env, userOf("recDAD"), EVENT_ID, { status: "going", answers: { dietary: "None" } })).rejects.toThrow(/T-shirt size/);
    invalidateAll();
    let calls = fake({ events: [asks] });
    await respondToEvent(env, userOf("recDAD"), EVENT_ID, { status: "not_going" });
    expect(upsertOf(calls)!.body[0]).toMatchObject({ status: "not_going", answers: {} });
    invalidateAll();
    calls = fake({ events: [asks], offices: { "uuid-sec": [{ id: "office" }] } });
    await respondToEvent(env, userOf("recSEC"), EVENT_ID, { personId: "recDAD", status: "going", asManager: true });
    expect(upsertOf(calls)!.body[0]).toMatchObject({ person_id: "uuid-dad", status: "going" });
  });
});

describe("attendance and the commitment review", () => {
  it("ticks the social functions recorded, in the review's order", () => {
    expect(
      recordedSocialFunctions([
        { id: "1", type: "social_function", title: "Xmas", startsAt: "2026-12-11T11:00:00Z", socialFunction: "Christmas Party" },
        { id: "2", type: "team_social", title: "Curry", startsAt: "2026-11-01T11:00:00Z", socialFunction: null },
        { id: "3", type: "social_function", title: "SOS", startsAt: "2026-09-01T11:00:00Z", socialFunction: "Start of Season" },
      ]),
    ).toEqual(["Start of Season", "Christmas Party"]);
    expect(recordedSocialFunctions(undefined)).toEqual([]);
  });

  it("counts Going at published events in the period that have started, not no-shows", async () => {
    const calls = fake({ responses: [{ person_id: "uuid-dad", event: { id: "e1", event_type: "social_function", title: "Xmas", starts_at: "2026-01-10T11:00:00Z", social_function: "Christmas Party" } }] });
    const out = await attendedEvents(env, "recDAD", "2025-07-01", "2026-06-30");
    expect(out).toEqual([{ id: "e1", type: "social_function", title: "Xmas", startsAt: "2026-01-10T11:00:00Z", socialFunction: "Christmas Party" }]);
    const q = calls.find((c) => c.url.pathname.endsWith("/event_responses"))!.url.searchParams;
    expect(q.get("status")).toBe("eq.going");
    expect(q.get("no_show")).toBe("is.false");
    expect(q.get("event.status")).toBe("eq.published");
    expect(q.getAll("event.starts_at")[0]).toBe("gte.2025-07-01T00:00:00+08:00");
    // No period, nothing to look up.
    expect(await attendedEvents(env, "recDAD", null, "2026-06-30")).toEqual([]);
  });

  it("marks who didn't come only once the event has started", async () => {
    fake({ events: [event()], offices: { "uuid-sec": [{ id: "office" }] } });
    await expect(markNoShow(env, userOf("recSEC"), EVENT_ID, { personId: "recDAD", noShow: true })).rejects.toThrow(/once the event has started/);
    invalidateAll();
    const calls = fake({ events: [event({ starts_at: new Date(Date.now() - day).toISOString() })], offices: { "uuid-sec": [{ id: "office" }] } });
    await markNoShow(env, userOf("recSEC"), EVENT_ID, { personId: "recDAD", noShow: true });
    const write = calls.find((c) => c.url.pathname.endsWith("/event_responses") && c.method === "PATCH")!;
    expect(write.body).toEqual({ no_show: true });
    expect(write.url.searchParams.get("status")).toBe("eq.going");
  });
});
