import { afterEach, describe, expect, it, vi } from "vitest";
import { signedIn } from "./helpers/factories";
import type { Env } from "../worker/src/env";
import type { AuthorizedUser } from "../worker/src/auth";
import { getQuiz, markQuiz, quizScoreBoard, submitQuiz } from "../worker/src/quizzes";

const env = { DATA_SUPABASE_URL: "https://proj.supabase.co", DATA_SUPABASE_SECRET_KEY: "sb_secret_test" } as Env;
const player = signedIn({ email: "p@x.com", personId: "recPLAYER", personUuid: "uuid-player" });
const captain = { ...player, officerRoles: [{ office: "sectionCaptain", designation: "Men's Captain" }] } as unknown as AuthorizedUser;

const QUESTIONS = [
  { id: "q1", text: "Q1. Green card?", options: [{ id: "a", label: "2 min" }, { id: "b", label: "5 min" }], correct: ["a"], points: 1, explanation: "A green card is 2 minutes." },
  { id: "q2", text: "Q2. Yellow card?", options: [{ id: "c", label: "5 min" }, { id: "d", label: "10 min" }], correct: ["c"], points: 1, explanation: null },
];
const QUIZ = { key: "Hockey Rules Quiz 1.0", title: "THE FAMOUS MEN'S HOCKEY RULES QUIZ 1.0", intro: "Hi {name}.", questions: QUESTIONS };

type Call = { url: URL; method: string; body: any };
function fake(tables: Record<string, unknown[]> = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const table = url.pathname.split("/").pop()!;
    const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (method !== "GET") return reply([{}]);
    if (table === "quizzes") return reply([QUIZ]);
    if (table === "people") return reply([{ id: "uuid-player" }]);
    return reply(tables[table] ?? []);
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("Hockey Rules quizzes", () => {
  it("sends the questions without their answers", async () => {
    fake();
    const q = await getQuiz(env, player, "Hockey Rules Quiz 1.0");
    expect(q.questions[0]).toEqual({ id: "q1", text: "Q1. Green card?", options: QUESTIONS[0].options });
    expect(JSON.stringify(q)).not.toMatch(/correct|explanation|2 minutes/);
  });

  it("marks each answer, scoring a point for each right one", () => {
    const r = markQuiz(QUESTIONS, { q1: "a", q2: "d" });
    expect(r).toMatchObject({ score: 1, points: 2 });
    expect(r.answers[1]).toEqual({ id: "q2", chosen: "d", correct: ["c"], right: false, explanation: null });
    // An option that isn't the question's own counts as no answer.
    expect(markQuiz(QUESTIONS, { q1: "c", q2: "c" }).answers[0].chosen).toBeNull();
  });

  it("needs every question answered, then keeps the latest score", async () => {
    fake();
    await expect(submitQuiz(env, player, "Hockey Rules Quiz 1.0", { answers: { q1: "a" } })).rejects.toThrow(/every question/);
    const calls = fake();
    const r = await submitQuiz(env, player, "Hockey Rules Quiz 1.0", { answers: { q1: "a", q2: "c" } });
    expect(r.score).toBe(2);
    const write = calls.find((c) => c.url.pathname.endsWith("/quiz_scores") && c.method === "POST")!;
    expect(write.url.searchParams.get("on_conflict")).toBe("person_id,quiz");
    expect(write.body[0]).toMatchObject({ person_id: "uuid-player", quiz: "Hockey Rules Quiz 1.0", score: 2 });
  });

  it("shows everyone's scores to Section Captains only", async () => {
    fake({ quiz_scores: [{ quiz: "Hockey Rules Quiz 1.0", score: 18, people: { api_id: "recA", preferred_name: "Sam", given_names: null, surname: "Lee" } }] });
    await expect(quizScoreBoard(env, player)).rejects.toThrow(/Section Captains/);
    const board = await quizScoreBoard(env, captain);
    expect(board.people).toEqual([{ id: "recA", name: "Sam Lee", scores: { "Hockey Rules Quiz 1.0": 18 } }]);
    expect(board.quizzes[0]).toEqual({ key: "Hockey Rules Quiz 1.0", title: QUIZ.title, points: 2 });
  });
});
